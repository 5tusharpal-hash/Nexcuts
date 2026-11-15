import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneVerificationForm } from "@/features/auth/components/phone-verification-form";

export const metadata: Metadata = {
  title: "Verify phone",
};

export default function VerifyPhonePage() {
  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl">Verify your phone</CardTitle>
        <CardDescription>Enter the 6-digit code sent to your phone number.</CardDescription>
      </CardHeader>
      <CardContent>
        <PhoneVerificationForm />
      </CardContent>
    </Card>
  );
}
