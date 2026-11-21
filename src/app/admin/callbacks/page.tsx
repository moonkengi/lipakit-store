import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { MpesaCallbackKind } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { ActionForm } from "../action-form";
import { replayCallbackAction } from "../actions";
import { dateTime, Filters, PageHeader, str, Table, Td } from "../ui";

const KINDS: MpesaCallbackKind[] = ["stk", "c2b_confirm", "c2b_validate", "ratiba", "b2c_result", "b2c_timeout"];
const REPLAYABLE = new Set<string>(["stk", "c2b_confirm", "ratiba", "b2c_result", "b2c_timeout"]);

export default function CallbacksPage({ searchParams }: PageProps<"/admin/callbacks">) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Callback log"
        description="Every Daraja callback, stored before processing. Replay runs processing again on the stored payload; it's safe because processing is idempotent."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Callbacks searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Callbacks({ searchParams }: Pick<PageProps<"/admin/callbacks">, "searchParams">) {
  await requireAdmin();
  const p = await searchParams;
  const values = { kind: str(p.kind), status: str(p.status), id: str(p.id) };
  let query = (await createClient())
    .from("mpesa_callbacks")
    .select("id, kind, received_at, processed_at, error, replay_count, payload")
    .order("received_at", { ascending: false })
    .limit(100);
  if (values.id) query = query.eq("id", values.id);
  if (values.kind) query = query.eq("kind", values.kind as MpesaCallbackKind);
  if (values.status === "errors") query = query.not("error", "is", null);
  if (values.status === "unprocessed") query = query.is("processed_at", null);
  const { data: rows } = await query;

  return (
    <>
      <Filters
        action="/admin/callbacks"
        values={values}
        selects={[
          { name: "kind", label: "Kind", options: KINDS },
          { name: "status", label: "Status", options: ["errors", "unprocessed"] },
        ]}
      />
      <Table head={["Received", "Kind", "Result", "Payload", ""]} empty={!rows?.length}>
        {rows?.map((c) => (
          <tr key={c.id}>
            <Td>{dateTime.format(new Date(c.received_at))}</Td>
            <Td mono>{c.kind}</Td>
            <Td className="max-w-72">
              {c.error ? (
                <span className="text-destructive">{c.error}</span>
              ) : c.processed_at ? (
                <span className="text-muted-foreground">Processed</span>
              ) : (
                <span className="text-muted-foreground">Not processed</span>
              )}
              {c.replay_count > 0 && <div className="text-xs text-muted-foreground">Replayed {c.replay_count}×</div>}
            </Td>
            <Td>
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">Show</summary>
                <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(c.payload, null, 2)}
                </pre>
              </details>
            </Td>
            <Td>
              {REPLAYABLE.has(c.kind) && (c.error || !c.processed_at) && (
                <ActionForm action={replayCallbackAction}>
                  <input type="hidden" name="callbackId" value={c.id} />
                  <Button type="submit" size="sm" variant="outline">
                    Replay
                  </Button>
                </ActionForm>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
