ALTER TABLE "leads" DROP CONSTRAINT "leads_source_check";--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_check" CHECK ("leads"."source" IN ('call','form','text')) NOT VALID;--> statement-breakpoint
ALTER TABLE "leads" VALIDATE CONSTRAINT "leads_source_check";
