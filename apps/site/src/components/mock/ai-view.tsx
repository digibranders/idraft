'use client';

import { useState } from 'react';
import { Check, Minus } from '@phosphor-icons/react';

import { ENGINES, PROMPTS } from './data';

/** Topics and prompts: pick a prompt, read what each engine said, see your brand and rivals picked out. */
export function AiView({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState(0);
  const prompt = PROMPTS[selected] ?? PROMPTS[0];
  if (!prompt) return null;
  const named = ENGINES.filter((engine) => prompt.results[engine].named).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4 lg:flex-row">
      {compact ? null : (
        <ul className="hidden w-[248px] shrink-0 flex-col gap-1.5 lg:flex" aria-label="Prompts">
          {PROMPTS.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={index === selected}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-200 ${index === selected ? 'bg-wash ring-1 ring-cobalt/25' : 'bg-surface ring-1 ring-ink/[0.06] hover:bg-paper'}`}
              >
                <p className="text-[11px] text-ink-3">{item.topic}</p>
                <p className="mt-0.5 text-[13px] leading-snug font-medium text-ink">{item.prompt}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="rounded-lg bg-surface p-4 ring-1 ring-ink/[0.06]">
          <p className="text-[11px] text-ink-3">Prompt</p>
          <p className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em]">{prompt.prompt}</p>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
            {prompt.answer.map((part, index) => (
              <span key={index} className={part.mention ? 'rounded bg-wash px-0.5 font-medium text-cobalt-deep' : part.rival ? 'rounded bg-ink/5 px-0.5 font-medium text-ink' : ''}>
                {part.text}
              </span>
            ))}
          </p>
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Cited sources">
            {prompt.sources.map((source) => (
              <li key={source.domain} className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ${source.own ? 'bg-wash text-cobalt-deep' : 'bg-ink/5 text-ink-2'}`}>
                {source.domain}
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-ink/[0.06]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-8 bg-paper text-[11px] font-medium text-ink-3">
                <th className="px-3 font-medium">Engine</th>
                <th className="px-3 font-medium">Named</th>
                <th className="px-3 text-right font-medium">Position</th>
                <th className="px-3 font-medium">Cited</th>
              </tr>
            </thead>
            <tbody>
              {ENGINES.map((engine) => {
                const result = prompt.results[engine];
                return (
                  <tr key={engine} className="h-9 border-t border-line">
                    <td className="px-3 font-medium text-ink">{engine}</td>
                    <td className="px-3">{result.named ? <Check size={14} weight="bold" aria-label="Named" className="text-[#0F7B4F]" /> : <Minus size={14} aria-label="Not named" className="text-ink-3" />}</td>
                    <td className="px-3 text-right font-mono text-ink-2">{result.position ?? '-'}</td>
                    <td className="px-3">{result.cited ? <Check size={14} weight="bold" aria-label="Cited" className="text-[#0F7B4F]" /> : <Minus size={14} aria-label="Not cited" className="text-ink-3" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="font-mono text-[10px] text-ink-3">Named in {named} of 4 engines · Illustrative data</p>
      </div>
    </div>
  );
}
