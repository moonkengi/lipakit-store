/**
 * Database types for the Supabase clients.
 *
 * Hand-written to match supabase/migrations so the kit type-checks out of the
 * box. Once you have a Supabase project, regenerate with:
 *
 *   pnpm db:types
 *
 * and this file is replaced by the CLI's output (same shape).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string; updated_at: string };

/** Build Row/Insert/Update for a table. `D` lists columns that have defaults. */
type Table<Row, D extends keyof Row, R extends Relationship[] = []> = {
  Row: Row;
  Insert: Omit<Row, D> & Partial<Pick<Row, D>>;
  Update: Partial<Row>;
  Relationships: R;
};

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type ProfileRole = "user" | "admin";
export type PlanInterval = "month" | "quarter" | "year";
export type SubscriptionStatus = "trialing" | "active" | "grace" | "expired" | "canceled";
export type OrderPurpose = "subscription" | "renewal" | "one_off";
export type OrderStatus = "pending" | "paid" | "failed" | "expired" | "needs_review" | "cancelled";
export type MpesaKind = "stk" | "c2b" | "b2c" | "ratiba";
export type MpesaTransactionStatus = "pending" | "success" | "failed" | "cancelled" | "timeout" | "unmatched";
export type MpesaCallbackKind = "stk" | "c2b_validate" | "c2b_confirm" | "b2c_result" | "b2c_timeout" | "ratiba";
export type RenewalMethod = "manual" | "ratiba";
export type RatibaStatus = "requested" | "active" | "failed" | "cancelled";

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      profiles: Table<
        Timestamps & {
          id: string;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          role: ProfileRole;
          telegram_chat_id: number | null;
        },
        "created_at" | "updated_at" | "full_name" | "email" | "phone" | "role" | "telegram_chat_id"
      >;
      plans: Table<
        Timestamps & {
          id: string;
          code: string;
          name: string;
          description: string | null;
          price_kes: number;
          interval: PlanInterval;
          trial_days: number;
          features: Json;
          sort_order: number;
          is_active: boolean;
        },
        "id" | "created_at" | "updated_at" | "description" | "trial_days" | "features" | "sort_order" | "is_active"
      >;
      subscriptions: Table<
        Timestamps & {
          id: string;
          user_id: string;
          plan_id: string;
          status: SubscriptionStatus;
          current_period_start: string;
          current_period_end: string;
          grace_until: string | null;
          cancel_at_period_end: boolean;
          renewal_method: RenewalMethod;
          ratiba_account_ref: string | null;
          ratiba_status: RatibaStatus | null;
        },
        | "id"
        | "created_at"
        | "updated_at"
        | "grace_until"
        | "cancel_at_period_end"
        | "renewal_method"
        | "ratiba_account_ref"
        | "ratiba_status",
        [
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      orders: Table<
        Timestamps & {
          id: string;
          user_id: string;
          subscription_id: string | null;
          plan_id: string | null;
          purpose: OrderPurpose;
          amount_kes: number;
          account_ref: string;
          status: OrderStatus;
          status_reason: string | null;
          paid_at: string | null;
        },
        "id" | "created_at" | "updated_at" | "subscription_id" | "plan_id" | "status" | "status_reason" | "paid_at",
        [
          {
            foreignKeyName: "orders_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      mpesa_transactions: Table<
        Timestamps & {
          id: string;
          order_id: string | null;
          kind: MpesaKind;
          merchant_request_id: string | null;
          checkout_request_id: string | null;
          mpesa_receipt: string | null;
          phone: string | null;
          amount_kes: number | null;
          result_code: number | null;
          result_desc: string | null;
          status: MpesaTransactionStatus;
          raw: Json | null;
          account_ref: string | null;
          transaction_time: string | null;
        },
        | "id"
        | "created_at"
        | "updated_at"
        | "order_id"
        | "merchant_request_id"
        | "checkout_request_id"
        | "mpesa_receipt"
        | "phone"
        | "amount_kes"
        | "result_code"
        | "result_desc"
        | "status"
        | "raw"
        | "account_ref"
        | "transaction_time",
        [
          {
            foreignKeyName: "mpesa_transactions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ]
      >;
      mpesa_callbacks: Table<
        {
          id: string;
          created_at: string;
          kind: MpesaCallbackKind;
          payload: Json;
          received_at: string;
          processed_at: string | null;
          error: string | null;
          replay_count: number;
        },
        "id" | "created_at" | "received_at" | "processed_at" | "error" | "replay_count"
      >;
      receipts: Table<
        {
          id: string;
          created_at: string;
          order_id: string;
          number: string;
          pdf_path: string | null;
          emailed_at: string | null;
          sms_at: string | null;
        },
        "id" | "created_at" | "pdf_path" | "emailed_at" | "sms_at",
        [
          {
            foreignKeyName: "receipts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ]
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      mpesa_settle_stk: {
        Args: {
          p_checkout_request_id: string;
          p_tx_status: string;
          p_order_status: string;
          p_order_reason: string;
          p_result_code?: number;
          p_result_desc?: string;
          p_receipt?: string;
          p_phone?: string;
          p_raw?: Json;
          p_receipt_prefix?: string;
        };
        Returns: string;
      };
      mpesa_settle_c2b: {
        Args: {
          p_trans_id: string;
          p_amount: number;
          p_account_ref: string;
          p_phone: string;
          p_trans_time: string;
          p_raw: Json;
          p_order_id?: string;
          p_subscription_id?: string;
          p_order_status?: string;
          p_order_reason?: string;
          p_receipt_prefix?: string;
        };
        Returns: string;
      };
      billing_apply_paid_order: { Args: { p_order_id: string; p_receipt_prefix?: string }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicTables = Database["public"]["Tables"];
export type Tables<T extends keyof PublicTables> = PublicTables[T]["Row"];
export type TablesInsert<T extends keyof PublicTables> = PublicTables[T]["Insert"];
export type TablesUpdate<T extends keyof PublicTables> = PublicTables[T]["Update"];
