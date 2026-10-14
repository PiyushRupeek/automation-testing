import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { LLMClient, CreateChatCompletionOptions, LLMResponse } from '@browserbasehq/stagehand';

/**
 * Custom LLMClient that plugs our project's Anthropic SDK into Stagehand.
 * Stagehand's bundled SDK only knows older model names; this client lets us
 * use any model the API key supports (e.g. claude-sonnet-4-6).
 */
export class ClaudeCustomLLMClient extends LLMClient {
  private client: Anthropic;
  public type = 'anthropic' as const;
  public hasVision = true;

  constructor(apiKey: string, modelName = 'claude-sonnet-4-6') {
    super(modelName as any);
    this.modelName = modelName as any;
    this.client = new Anthropic({ apiKey });
  }

  async createChatCompletion<T = LLMResponse>(
    { options, logger, retries = 0 }: CreateChatCompletionOptions
  ): Promise<T> {
    // --- Separate system message from user/assistant messages ---
    const systemMsg = options.messages.find(m => m.role === 'system');
    const userMsgs = options.messages.filter(m => m.role !== 'system');

    // --- Convert messages to Anthropic format ---
    const formattedMessages: Anthropic.MessageParam[] = userMsgs.map(msg => {
      if (typeof msg.content === 'string') {
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: (msg.content as any[]).map((part: any) => {
          if (part.type === 'image_url') {
            // Anthropic expects raw base64 bytes — strip the data URI prefix if present
            // e.g. "data:image/jpeg;base64,<bytes>" → "<bytes>"
            const rawUrl: string = part.image_url.url ?? '';
            const base64Data = rawUrl.startsWith('data:')
              ? rawUrl.split(',')[1] ?? rawUrl
              : rawUrl;
            const mediaType = rawUrl.startsWith('data:image/png')
              ? 'image/png' as const
              : 'image/jpeg' as const;
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: mediaType,
                data: base64Data,
              },
            };
          }
          return { type: 'text' as const, text: part.text };
        }),
      };
    });

    // If there's an inline image, append it to the last user message
    if (options.image) {
      const imgBuffer = options.image.buffer;
      const base64Data = Buffer.isBuffer(imgBuffer)
        ? imgBuffer.toString('base64')
        : Buffer.from(imgBuffer).toString('base64');
      const imgPart: Anthropic.ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: base64Data,
        },
      };
      const descPart: Anthropic.TextBlockParam[] = options.image.description
        ? [{ type: 'text', text: options.image.description }]
        : [];
      formattedMessages.push({ role: 'user', content: [imgPart, ...descPart] });
    }

    // --- Build tools list ---
    const anthropicTools: Anthropic.Tool[] = [];

    // Pass through any tools from Stagehand (doAction / skipSection)
    if (options.tools) {
      for (const tool of options.tools) {
        anthropicTools.push({
          name: tool.name,
          description: tool.description ?? '',
          input_schema: (tool.parameters ?? { type: 'object', properties: {} }) as any,
        });
      }
    }

    // response_model → add a print_extracted_data tool
    if (options.response_model) {
      const jsonSchema: any = zodToJsonSchema(options.response_model.schema as any);
      const properties = jsonSchema.definitions?.MySchema?.properties ?? jsonSchema.properties ?? {};
      const required = jsonSchema.definitions?.MySchema?.required ?? jsonSchema.required ?? [];
      anthropicTools.push({
        name: 'print_extracted_data',
        description: 'Prints the extracted data based on the provided schema.',
        input_schema: { type: 'object', properties, required } as any,
      });
    }

    const system = systemMsg
      ? (typeof systemMsg.content === 'string' ? systemMsg.content : '')
      : undefined;

    const response = await this.client.messages.create({
      model: this.modelName as string,
      max_tokens: options.maxTokens ?? 8192,
      messages: formattedMessages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      ...(system ? { system } : {}),
      temperature: options.temperature ?? 0.1,
    });

    logger?.({
      category: 'anthropic',
      message: 'response',
      level: 1,
      auxiliary: {
        response: { value: JSON.stringify(response), type: 'object' },
        requestId: { value: options.requestId, type: 'string' },
      },
    });

    // --- Handle response_model: extract tool_use input directly ---
    if (options.response_model) {
      const toolUse = response.content.find(c => c.type === 'tool_use') as any;
      if (toolUse?.input) {
        return toolUse.input as T;
      }
      // retry up to 5 times
      if (retries < 5) {
        return this.createChatCompletion({ options, logger, retries: retries + 1 });
      }
      throw new Error('createChatCompletion: no tool_use in response after retries');
    }

    // --- Standard LLMResponse format ---
    const textContent = response.content.find(c => c.type === 'text') as any;
    const toolCalls = response.content
      .filter(c => c.type === 'tool_use')
      .map((c: any) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.input) },
      }));

    const transformed: LLMResponse = {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent?.text ?? null,
            tool_calls: toolCalls,
          },
          finish_reason: response.stop_reason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };

    return transformed as T;
  }
}
