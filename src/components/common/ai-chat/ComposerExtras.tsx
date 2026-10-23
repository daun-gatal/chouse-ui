/**
 * Chat composer extras (ADR 0024): files attached to the next message, the
 * skills it pins, and the `/` skill picker.
 */

import { useEffect, useRef } from 'react';
import { BookOpen, FileText, Image as ImageIcon, X } from 'lucide-react';

import type { ChatSkill } from '@/api/ai-chat';
import type { AttachmentKind } from '@/lib/chatComposer';

export interface ComposerAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  data: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ComposerChipsProps {
  attachments: ComposerAttachment[];
  skills: string[];
  onRemoveAttachment: (id: string) => void;
}

/** Files and skills that go with the next message; empty renders nothing. */
export function ComposerChips({ attachments, skills, onRemoveAttachment }: ComposerChipsProps): React.JSX.Element | null {
  if (attachments.length === 0 && skills.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Sent with your message">
      {skills.map((name) => (
        <span key={`skill-${name}`} className="inline-flex max-w-full items-center gap-1.5 rounded-xs border border-brand/40 bg-brand/5 px-2 py-1 font-mono text-[10px] text-brand" title="This skill's instructions go to the assistant with your message">
          <BookOpen className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{name}</span>
        </span>
      ))}
      {attachments.map((file) => {
        const Icon = file.kind === 'image' ? ImageIcon : FileText;
        return (
          <span key={file.id} className="inline-flex max-w-full items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-100 py-1 pl-2 pr-1 font-mono text-[10px] text-paper-muted">
            <Icon className="h-3 w-3 shrink-0 text-paper-dim" aria-hidden />
            <span className="max-w-[180px] truncate" title={file.name}>{file.name}</span>
            <span className="text-paper-faint">{formatSize(file.size)}</span>
            <button
              type="button"
              onClick={() => onRemoveAttachment(file.id)}
              className="grid h-4 w-4 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
              aria-label={`Remove ${file.name}`}
              title={`Remove ${file.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

interface SkillSuggestionsProps {
  skills: ChatSkill[];
  activeIndex: number;
  onPick: (name: string) => void;
  onHover: (index: number) => void;
}

/** The `/` picker above the composer; the composer owns the keyboard. */
export function SkillSuggestions({ skills, activeIndex, onPick, onHover }: SkillSuggestionsProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Skills"
      className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-y-auto rounded-xs border border-ink-500 bg-ink-100 py-1 shadow-lg"
    >
      <p className="px-3 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint">Use a skill · ↑↓ to choose, Enter to add</p>
      {skills.length === 0 ? (
        <p className="px-3 py-2 text-[12px] text-paper-muted">No skill matches. This agent's skills are listed in AI Governance › Assistant.</p>
      ) : skills.map((skill, index) => (
        <button
          key={skill.name}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          data-index={index}
          onMouseDown={(e) => {
            // Keep focus in the composer.
            e.preventDefault();
            onPick(skill.name);
          }}
          onMouseEnter={() => onHover(index)}
          className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${index === activeIndex ? 'bg-ink-300' : 'hover:bg-ink-200'}`}
        >
          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0">
            <span className="block font-mono text-[11px] text-paper">/skill:{skill.name}</span>
            {skill.description && <span className="block truncate text-[11px] text-paper-muted">{skill.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
