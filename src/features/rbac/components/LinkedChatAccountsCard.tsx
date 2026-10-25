/**
 * Linked chat accounts (ADR 0026 §4): who you are when you press a button in
 * a CHouse alert. Slack and Google Chat match you by your email; Telegram has
 * no email, so you link it by opening a one-time link from your account.
 */

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Link2, Loader2, MessageCircle, Send, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MONO_FAINT, MONO_LABEL, SettingCard } from "@/pages/Preferences";
import { createTelegramLink, getChatIdentities, unlinkChatIdentity } from "@/api/chatIdentities";
import { log } from "@/lib/log";

const QUERY_KEY = ["chat-identities"];
const ROW = "flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

export const LinkedChatAccountsCard: React.FC = () => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: QUERY_KEY, queryFn: getChatIdentities });
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);

  const makeLink = useMutation({
    mutationFn: (bot: string) => createTelegramLink(bot),
    onSuccess: (result) => setLink({ url: result.link, expiresAt: result.expiresAt }),
    onError: (e) => {
      log.error("[LinkedChatAccounts] Failed to make a Telegram link", { message: errMessage(e) });
      toast.error(errMessage(e));
    },
  });

  const unlink = useMutation({
    mutationFn: (id: string) => unlinkChatIdentity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Telegram unlinked");
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const telegram = data?.identities.find((i) => i.platform === "telegram") ?? null;
  const bot = data?.telegramBots[0] ?? null;

  return (
    <SettingCard title="Linked chat accounts" description="Who you are when you press a button in an alert" icon={Link2} delay={0.5} className="md:col-span-3">
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <p role="alert" className="text-[12px] text-red-300">{errMessage(error)}</p>
      ) : (
        <div className="space-y-2">
          <div className={ROW}>
            <span className="flex items-center gap-2 text-[13px] text-paper"><MessageCircle className="h-4 w-4 text-paper-dim" aria-hidden /> Slack</span>
            <span className={MONO_FAINT}>Matched by email · {data?.email}</span>
          </div>
          <div className={ROW}>
            <span className="flex items-center gap-2 text-[13px] text-paper"><MessageCircle className="h-4 w-4 text-paper-dim" aria-hidden /> Google Chat</span>
            <span className={MONO_FAINT}>Matched by email · {data?.email}</span>
          </div>
          <div className={ROW}>
            <span className="flex items-center gap-2 text-[13px] text-paper"><Send className="h-4 w-4 text-paper-dim" aria-hidden /> Telegram</span>
            {telegram ? (
              <span className="flex items-center gap-3">
                <span className={MONO_LABEL}>{telegram.displayName ?? telegram.externalId}</span>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[12px]" onClick={() => unlink.mutate(telegram.id)} disabled={unlink.isPending}>
                  {unlink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" aria-hidden />} Unlink
                </Button>
              </span>
            ) : bot ? (
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]" onClick={() => makeLink.mutate(bot)} disabled={makeLink.isPending}>
                {makeLink.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Link Telegram
              </Button>
            ) : (
              <span className={MONO_FAINT}>No Telegram channel takes button presses yet</span>
            )}
          </div>
          {link && !telegram && (
            <div className="rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-[12px] text-paper-muted">
              Open{" "}
              <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                the bot <ExternalLink className="h-3 w-3" aria-hidden />
              </a>{" "}
              from your Telegram account and press Start. The link works once and expires at {new Date(link.expiresAt).toLocaleTimeString()}.{" "}
              <button type="button" className="text-paper underline" onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}>I've linked it</button>
            </div>
          )}
        </div>
      )}
    </SettingCard>
  );
};
