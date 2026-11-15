ALTER TABLE "account_notifications"
ADD COLUMN "delivery_key" VARCHAR(120);

CREATE UNIQUE INDEX "account_notifications_delivery_key_key"
ON "account_notifications"("delivery_key");
