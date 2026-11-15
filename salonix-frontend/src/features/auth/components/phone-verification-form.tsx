"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  phoneVerificationSchema,
  type PhoneVerificationValues,
} from "@/features/auth/schemas/phone-verification.schema";
import {
  requestPhoneVerification,
  requestEmailVerification,
  verifyPhone,
} from "@/features/auth/services/auth.service";

export function PhoneVerificationForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [phoneNumber, setPhoneNumber] = useState("");

  useEffect(() => {
    setPhoneNumber(sessionStorage.getItem("salonix:verification-phone") ?? "");
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PhoneVerificationValues>({
    resolver: zodResolver(phoneVerificationSchema),
  });

  async function onSubmit(values: PhoneVerificationValues) {
    if (!phoneNumber) {
      setServerError("Phone number is missing. Please sign up again.");
      return;
    }
    setServerError(undefined);
    try {
      await verifyPhone(phoneNumber, values.code);
      await requestEmailVerification();
      sessionStorage.removeItem("salonix:verification-phone");
      sessionStorage.removeItem("salonix:verification-message");
      router.push("/verify-email");
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to verify phone number");
    }
  }

  async function resendCode() {
    if (!phoneNumber) {
      setServerError("Phone number is missing. Please sign up again.");
      return;
    }
    setServerError(undefined);
    try {
      const response = await requestPhoneVerification(phoneNumber);
      setNotice(response.data?.message ?? "Verification code sent.");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to resend code");
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="rounded-lg bg-surface-primary px-3 py-2 text-center text-sm text-text-secondary">
        Verification code sent to <strong>{phoneNumber || "your phone"}</strong>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="verification-code">6-digit code</Label>
        <Input
          id="verification-code"
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
      <Button className="w-full" type="submit" disabled={isSubmitting || !phoneNumber}>
        {isSubmitting && <LoaderCircle className="animate-spin" />}
        Verify phone
      </Button>
      <Button className="w-full" type="button" variant="outline" onClick={resendCode}>
        Resend code
      </Button>
    </form>
  );
}
