export interface OtpProvider {
  requestOtp(mobile?: string): Promise<string>;
}
