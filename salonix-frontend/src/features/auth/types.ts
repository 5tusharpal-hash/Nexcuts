export interface AuthResponse {
  success?: boolean;
  data?: {
    user?: {
      id: string;
      name: string;
      email: string;
    };
    token?: string;
    verificationRequired?: boolean;
    message?: string;
    developmentOtp?: string;
  };
  error?: {
    message?: string;
    code?: string;
  };
}
