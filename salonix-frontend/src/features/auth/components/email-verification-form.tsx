"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emailVerificationSchema,
  type EmailVerificationValues,
} from "@/features/auth/schemas/email-verification.schema";
import {
  requestEmailVerification,
  verifyEmail,
} from "@/features/auth/services/auth.service";

export function EmailVerificationForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailVerificationValues>({
    resolver: zodResolver(emailVerificationSchema),
  });

  async function onSubmit(values: EmailVerificationValues) {
    setServerError(undefined);
    try {
      await verifyEmail(values.code);
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to verify email");
    }
  }

  async function resendCode() {
    setServerError(undefined);
    try {
      const response = await requestEmailVerification();
      setNotice(response.data?.message ?? "Verification code sent.");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to resend code");
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-2">
        <Label htmlFor="email-verification-code">6-digit code</Label>
        <Input
          id="email-verification-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="text-center text-lg tracking-[0.45em]"
          aria-invalid={Boolean(errors.code)}
          {...register("code")}
        />
        {errors.code && <p className="text-sm text-state-error">{errors.code.message}</p>}
      </div>
      {notice && <Alert variant="info"><AlertDescription>{notice}</AlertDescription></Alert>}
      {serverError && <Alert variant="error"><AlertDescription>{serverError}</AlertDescription></Alert>}
      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting && <LoaderCircle className="animate-spin" />}
        Verify email
      </Button>
      <Button className="w-full" type="button" variant="outline" onClick={resendCode}>
        Resend code
      </Button>
    </form>
  );
}
