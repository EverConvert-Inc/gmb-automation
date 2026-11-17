CREATE TABLE IF NOT EXISTS "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number_id" uuid NOT NULL,
	"user_id" text,
	"wa_id" text,
	"profile_name" text,
	"username" text,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_referral" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_conversations_identity_check" CHECK ("whatsapp_conversations"."user_id" IS NOT NULL OR "whatsapp_conversations"."wa_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"wamid" text NOT NULL,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"body" text,
	"media_id" text,
	"media_mime_type" text,
	"media_filename" text,
	"referral" jsonb,
	"status" text NOT NULL,
	"error_message" text,
	"sent_by_email" text,
	"sent_at" timestamp with time zone NOT NULL,
	"status_updated_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wamid_unique" UNIQUE("wamid"),
	CONSTRAINT "whatsapp_messages_direction_check" CHECK ("whatsapp_messages"."direction" IN ('in','out'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text,
	"display_phone_number" text,
	"verified_name" text,
	"label" text,
	"quality_rating" text,
	"platform_type" text,
	"code_verification_status" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_numbers_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_number_id_whatsapp_numbers_id_fk" FOREIGN KEY ("number_id") REFERENCES "public"."whatsapp_numbers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_conversations_user_uniq" ON "whatsapp_conversations" USING btree ("number_id","user_id") WHERE "whatsapp_conversations"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_conversations_wa_uniq" ON "whatsapp_conversations" USING btree ("number_id","wa_id") WHERE "whatsapp_conversations"."wa_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_last_message_idx" ON "whatsapp_conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_messages_conversation_sent_idx" ON "whatsapp_messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_messages_media_idx" ON "whatsapp_messages" USING btree ("media_id") WHERE "whatsapp_messages"."media_id" is not null;