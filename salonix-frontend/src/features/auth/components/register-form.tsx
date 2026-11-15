"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { CountryCodeSelect } from "@/features/auth/components/country-code-select";
import { register as registerAccount } from "@/features/auth/services/auth.service";
import { registerSchema, type RegisterValues } from "@/features/auth/schemas/register.schema";
import {
  defaultCountryCode,
} from "@/features/auth/data/country-codes";

export function RegisterForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string>();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { countryCode: defaultCountryCode.dialCode },
  });

  async function onSubmit(values: RegisterValues) {
    setServerError(undefined);

    try {
      const response = await registerAccount(values);
      const phoneNumber = `${values.countryCode}${values.phoneNumber.replace(/^0+/, "")}`;
      sessionStorage.setItem("salonix:verification-phone", phoneNumber);
      sessionStorage.setItem("salonix:verification-message", response.data?.message ?? "");
      router.push("/verify-phone");
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to create account");
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="grid gap-2">
        <Label htmlFor="register-full-name">Full name</Label>
        <Input id="register-full-name" autoComplete="name" aria-invalid={Boolean(errors.fullName)} {...register("fullName")} />
        {errors.fullName && <p className="text-sm text-state-error">{errors.fullName.message}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="register-email">Email</Label>
        <Input id="register-email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} {...register("email")} />
        {errors.email && <p className="text-sm text-state-error">{errors.email.message}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="register-phone-number">Phone number</Label>
        <div className="flex gap-2">
          <Controller
            control={control}
            name="countryCode"
            render={({ field }) => (
              <CountryCodeSelect
                aria-label="Country code"
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
          <Input
            className="min-w-0 flex-1"
            id="register-phone-number"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="9876543210"
            aria-invalid={Boolean(errors.phoneNumber)}
            {...register("phoneNumber")}
          />
        </div>
        {errors.phoneNumber && <p className="text-sm text-state-error">{errors.phoneNumber.message}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="register-password">Password</Label>
        <PasswordInput id="register-password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} {...register("password")} />
        {errors.password && <p className="text-sm text-state-error">{errors.password.message}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="register-confirm-password">Confirm password</Label>
        <PasswordInput
          id="register-confirm-password"
          autoComplete="new-password"
          visibleLabel="Show confirm password"
          hiddenLabel="Hide confirm password"
          aria-invalid={Boolean(errors.confirmPassword)}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && <p className="text-sm text-state-error">{errors.confirmPassword.message}</p>}
      </div>

      {serverError && <Alert variant="error"><AlertDescription>{serverError}</AlertDescription></Alert>}

      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting && <LoaderCircle className="animate-spin" />}
        {isSubmitting ? "Creating account..." : "Create account"}
      </Button>

      <p className="text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link className="font-medium text-text-primary underline underline-offset-4" href="/login">Sign in</Link>
      </p>
    </form>
  );
}
