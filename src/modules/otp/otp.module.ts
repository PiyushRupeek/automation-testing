import { Global, Module } from '@nestjs/common';
import { OTP_PROVIDER } from '../../common/constants';
import { ApiOtpProvider } from './providers/api-otp.provider';
import { TerminalOtpProvider } from './providers/terminal-otp.provider';

@Global()
@Module({
  providers: [
    TerminalOtpProvider,
    ApiOtpProvider,
    {
      provide: OTP_PROVIDER,
      useFactory: (terminal: TerminalOtpProvider, api: ApiOtpProvider) => {
        const context = process.env.RUN_CONTEXT ?? 'cli';
        return context === 'api' ? api : terminal;
      },
      inject: [TerminalOtpProvider, ApiOtpProvider],
    },
  ],
  exports: [OTP_PROVIDER, TerminalOtpProvider, ApiOtpProvider],
})
export class OtpModule {}
