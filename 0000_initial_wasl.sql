CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"owner_id" uuid NOT NULL,
	"filename" varchar(180) NOT NULL,
	"mime" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_users" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_users_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "call_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"callee_id" uuid NOT NULL,
	"mode" varchar(10) NOT NULL,
	"state" varchar(16) DEFAULT 'ringing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(10) DEFAULT 'direct' NOT NULL,
	"direct_key" varchar(80),
	"title" varchar(100),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_direct_key_unique" UNIQUE("direct_key")
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(12) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"typing_until" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"kind" varchar(12) DEFAULT 'text' NOT NULL,
	"attachment_id" uuid,
	"reply_to_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(24) NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_receipts" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "message_receipts_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" varchar(250) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "status_views" (
	"status_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_views_status_id_viewer_id_pk" PRIMARY KEY("status_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"body" varchar(500) DEFAULT '' NOT NULL,
	"color" varchar(20) DEFAULT '#147c6d' NOT NULL,
	"attachment_id" uuid,
	"audience" varchar(16) DEFAULT 'contacts' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"public_id" varchar(8) NOT NULL,
	"name" varchar(80) NOT NULL,
	"about" varchar(160) DEFAULT 'مرحباً! أنا أستخدم وَصل.' NOT NULL,
	"avatar" text,
	"language" varchar(2) DEFAULT 'ar' NOT NULL,
	"theme" varchar(10) DEFAULT 'light' NOT NULL,
	"wallpaper" varchar(16) DEFAULT 'doodles' NOT NULL,
	"discoverable" boolean DEFAULT true NOT NULL,
	"notifications" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_signals" ADD CONSTRAINT "call_signals_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_signals" ADD CONSTRAINT "call_signals_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_users_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_users_id_fk" FOREIGN KEY ("reported_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_views" ADD CONSTRAINT "status_views_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_views" ADD CONSTRAINT "status_views_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_conversation_idx" ON "attachments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "call_signals_call_idx" ON "call_signals" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_callee_idx" ON "calls" USING btree ("callee_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_updated_idx" ON "conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_time_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_user_idx" ON "message_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "statuses_expiry_idx" ON "statuses" USING btree ("expires_at");