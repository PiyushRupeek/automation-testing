import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { FlowVariant } from '../../../common/types';
import { ExploreMode } from '../types/explorer.types';

export class ExploreRequestDto {
  @IsIn(['explore', 'verify', 'update'])
  mode!: ExploreMode;

  @IsOptional()
  @IsIn(['fresh', 'takeover', 'state-management'])
  variant?: FlowVariant;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  descriptorPath?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxSteps?: number;

  @IsOptional()
  @IsBoolean()
  headless?: boolean;
}
