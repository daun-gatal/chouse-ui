import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Loader2, Route, Save, ShieldCheck, Sliders, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    rbacAiConfigsApi,
    type AiCapabilityId,
    type AiConfig,
    type AiConfigPolicy,
    type AiConfigPolicyInput,
} from '@/api/rbac';
import { ApiError } from '@/api/client';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';

const CAPABILITY_OPTIONS: Array<{ id: AiCapabilityId; label: string }> = [
    { id: 'chat', label: 'Chat assistant' },
    { id: 'optimize-query', label: 'Optimize query' },
    { id: 'debug-query', label: 'Debug query' },
    { id: 'check-optimize', label: 'Optimization check' },
    { id: 'optimize-log', label: 'Optimize log query' },
    { id: 'diagnose-error', label: 'Diagnose error' },
    { id: 'diagnose-parts', label: 'Diagnose parts' },
    { id: 'diagnose-schema', label: 'Diagnose schema' },
    { id: 'fleet-scan', label: 'Fleet scan' },
];

type PolicyDraft = AiConfigPolicyInput & {
    providerOptionsText: string;
    fallbackConfigIdsText: string;
};

function emptyPolicy(capabilityId: AiCapabilityId): PolicyDraft {
    return {
        capabilityId,
        isEnabled: true,
        priority: 100,
        temperature: null,
        maxOutputTokens: null,
        stopAtSteps: null,
        maxContextMessages: null,
        maxToolCalls: null,
        maxResultRows: null,
        maxRuntimeMs: null,
        providerOptions: null,
        fallbackConfigIds: [],
        providerOptionsText: '',
        fallbackConfigIdsText: '',
    };
}

function policyToDraft(policy: AiConfigPolicy): PolicyDraft {
    return {
        capabilityId: policy.capabilityId,
        isEnabled: policy.isEnabled,
        priority: policy.priority,
        temperature: policy.temperature,
        maxOutputTokens: policy.maxOutputTokens,
        stopAtSteps: policy.stopAtSteps,
        maxContextMessages: policy.maxContextMessages,
        maxToolCalls: policy.maxToolCalls,
        maxResultRows: policy.maxResultRows,
        maxRuntimeMs: policy.maxRuntimeMs,
        providerOptions: policy.providerOptions,
        fallbackConfigIds: policy.fallbackConfigIds,
        providerOptionsText: policy.providerOptions ? JSON.stringify(policy.providerOptions, null, 2) : '',
        fallbackConfigIdsText: policy.fallbackConfigIds.join(', '),
    };
}

function nullableNumber(value: string): number | null {
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function draftToInput(draft: PolicyDraft): AiConfigPolicyInput {
    return {
        capabilityId: draft.capabilityId,
        isEnabled: draft.isEnabled,
        priority: draft.priority,
        temperature: draft.temperature,
        maxOutputTokens: draft.maxOutputTokens,
        stopAtSteps: draft.stopAtSteps,
        maxContextMessages: draft.maxContextMessages,
        maxToolCalls: draft.maxToolCalls,
        maxResultRows: draft.maxResultRows,
        maxRuntimeMs: draft.maxRuntimeMs,
        providerOptions: draft.providerOptionsText.trim()
            ? JSON.parse(draft.providerOptionsText) as Record<string, unknown>
            : null,
        fallbackConfigIds: draft.fallbackConfigIdsText
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
    };
}

const stepClass = (active: boolean, complete: boolean) =>
    `flex items-center gap-2 rounded-xs border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] ${
        active
            ? 'border-brand/50 bg-brand/10 text-paper'
            : complete
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-ink-500 bg-ink-200 text-paper-muted'
    }`;

export default function PoliciesTab() {
    const [configs, setConfigs] = useState<AiConfig[]>([]);
    const [policiesByConfig, setPoliciesByConfig] = useState<Record<string, AiConfigPolicy[]>>({});
    const [selectedConfigId, setSelectedConfigId] = useState<string>('');
    const [selectedCapabilities, setSelectedCapabilities] = useState<AiCapabilityId[]>([]);
    const [drafts, setDrafts] = useState<Record<AiCapabilityId, PolicyDraft>>({} as Record<AiCapabilityId, PolicyDraft>);
    const [activeCapabilityId, setActiveCapabilityId] = useState<AiCapabilityId>('chat');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const { hasPermission } = useRbacStore();
    const canEdit = hasPermission(RBAC_PERMISSIONS.AI_MODELS_UPDATE);

    const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
    const activeDraft = drafts[activeCapabilityId] ?? emptyPolicy(activeCapabilityId);
    const fallbackOptions = configs.filter((config) => config.id !== selectedConfigId && config.isActive);

    const capabilityOwners = useMemo(() => {
        const owners = new Map<AiCapabilityId, { config: AiConfig; policy: AiConfigPolicy }>();
        for (const capability of CAPABILITY_OPTIONS) {
            const matches = configs
                .flatMap((config) => (policiesByConfig[config.id] ?? [])
                    .filter((policy) => policy.capabilityId === capability.id && policy.isEnabled)
                    .map((policy) => ({ config, policy })))
                .sort((a, b) => a.policy.priority - b.policy.priority);
            if (matches[0]) owners.set(capability.id, matches[0]);
        }
        return owners;
    }, [configs, policiesByConfig]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const result = await rbacAiConfigsApi.list({ limit: 100 });
            const allConfigs = result.configs;
            const policyPairs = await Promise.all(
                allConfigs.map(async (config) => [config.id, await rbacAiConfigsApi.listPolicies(config.id)] as const),
            );
            const nextPolicies = Object.fromEntries(policyPairs);
            setConfigs(allConfigs);
            setPoliciesByConfig(nextPolicies);

            const firstActive = allConfigs.find((config) => config.isActive) ?? allConfigs[0];
            if (firstActive && !selectedConfigId) {
                setSelectedConfigId(firstActive.id);
                hydrateDrafts(firstActive.id, nextPolicies[firstActive.id] ?? []);
            } else if (selectedConfigId) {
                hydrateDrafts(selectedConfigId, nextPolicies[selectedConfigId] ?? []);
            }
        } catch {
            toast.error('Failed to load AI policies');
        } finally {
            setIsLoading(false);
        }
    };

    const hydrateDrafts = (configId: string, policies: AiConfigPolicy[]) => {
        const byCapability = new Map(policies.map((policy) => [policy.capabilityId, policy]));
        const nextDrafts = Object.fromEntries(
            CAPABILITY_OPTIONS.map(({ id }) => [id, byCapability.has(id) ? policyToDraft(byCapability.get(id)!) : emptyPolicy(id)]),
        ) as Record<AiCapabilityId, PolicyDraft>;
        const enabledCapabilities = policies.filter((policy) => policy.isEnabled).map((policy) => policy.capabilityId);
        setDrafts(nextDrafts);
        setSelectedCapabilities(enabledCapabilities);
        setActiveCapabilityId(enabledCapabilities[0] ?? 'chat');
        setSelectedConfigId(configId);
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectConfig = (configId: string) => {
        hydrateDrafts(configId, policiesByConfig[configId] ?? []);
    };

    const toggleCapability = (capabilityId: AiCapabilityId) => {
        setSelectedCapabilities((prev) => {
            const next = prev.includes(capabilityId)
                ? prev.filter((id) => id !== capabilityId)
                : [...prev, capabilityId];
            if (!prev.includes(capabilityId)) setActiveCapabilityId(capabilityId);
            return next;
        });
    };

    const updateActiveDraft = (patch: Partial<PolicyDraft>) => {
        setDrafts((prev) => ({
            ...prev,
            [activeCapabilityId]: {
                ...(prev[activeCapabilityId] ?? emptyPolicy(activeCapabilityId)),
                ...patch,
            },
        }));
    };

    const toggleFallback = (fallbackId: string, checked: boolean) => {
        const current = activeDraft.fallbackConfigIdsText
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        const next = checked
            ? [...current.filter((id) => id !== fallbackId), fallbackId]
            : current.filter((id) => id !== fallbackId);
        updateActiveDraft({ fallbackConfigIdsText: next.join(', ') });
    };

    const save = async () => {
        if (!selectedConfig) return;
        setIsSaving(true);
        try {
            const existing = policiesByConfig[selectedConfig.id] ?? [];
            const selected = new Set(selectedCapabilities);
            const untouched = existing.filter((policy) => !selected.has(policy.capabilityId));
            const nextPolicies = [
                ...untouched.map((policy) => ({
                    capabilityId: policy.capabilityId,
                    isEnabled: policy.isEnabled,
                    priority: policy.priority,
                    temperature: policy.temperature,
                    maxOutputTokens: policy.maxOutputTokens,
                    stopAtSteps: policy.stopAtSteps,
                    maxContextMessages: policy.maxContextMessages,
                    maxToolCalls: policy.maxToolCalls,
                    maxResultRows: policy.maxResultRows,
                    maxRuntimeMs: policy.maxRuntimeMs,
                    providerOptions: policy.providerOptions,
                    fallbackConfigIds: policy.fallbackConfigIds,
                })),
                ...selectedCapabilities.map((capabilityId) => draftToInput({
                    ...(drafts[capabilityId] ?? emptyPolicy(capabilityId)),
                    capabilityId,
                    isEnabled: true,
                })),
            ];

            const saved = await rbacAiConfigsApi.replacePolicies(selectedConfig.id, nextPolicies);
            setPoliciesByConfig((prev) => ({ ...prev, [selectedConfig.id]: saved }));
            hydrateDrafts(selectedConfig.id, saved);
            toast.success('AI policies updated');
            window.dispatchEvent(new CustomEvent('ai-config-updated'));
        } catch (error) {
            const message = error instanceof SyntaxError
                ? 'Provider options must be valid JSON'
                : error instanceof ApiError ? error.message : 'Failed to save policies';
            toast.error(message);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-14 text-center text-[12px] text-paper-muted">
                Loading policies...
            </div>
        );
    }

    if (configs.length === 0) {
        return (
            <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-14 text-center">
                <Sliders className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No deployments</h3>
                <p className="mt-2 text-[12px] text-paper-muted">Create a deployment before assigning policies.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                    <span className="h-px w-6 bg-ink-700" />
                    <span>Deployment policies</span>
                </span>
                <p className="text-[12px] text-paper-muted">Capability routing, runtime controls, and fallbacks.</p>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
                <div className={stepClass(Boolean(selectedConfig), Boolean(selectedConfig))}>
                    <Check className="h-3.5 w-3.5" /> Deployment
                </div>
                <div className={stepClass(selectedCapabilities.length === 0, selectedCapabilities.length > 0)}>
                    {selectedCapabilities.length > 0 ? <Check className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Capabilities
                </div>
                <div className={stepClass(selectedCapabilities.length > 0, false)}>
                    <Wand2 className="h-3.5 w-3.5" /> Controls
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="rounded-xs border border-ink-500 bg-ink-100">
                    <div className="border-b border-ink-500 px-4 py-3">
                        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim">Deployment</h3>
                    </div>
                    <div className="max-h-[460px] overflow-y-auto p-2">
                        {configs.map((config) => {
                            const isSelected = config.id === selectedConfigId;
                            const enabledCount = (policiesByConfig[config.id] ?? []).filter((policy) => policy.isEnabled).length;
                            return (
                                <button
                                    key={config.id}
                                    type="button"
                                    onClick={() => selectConfig(config.id)}
                                    className={`mb-2 w-full rounded-xs border p-3 text-left transition-colors ${isSelected ? 'border-brand/50 bg-brand/10' : 'border-ink-500 bg-ink-200 hover:bg-ink-300/40'}`}
                                >
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="truncate text-[13px] font-medium text-paper">{config.name}</span>
                                        <span className={`h-2 w-2 rounded-full ${config.isActive ? 'bg-emerald-400' : 'bg-ink-600'}`} />
                                    </span>
                                    <span className="mt-1 block truncate text-[11px] text-paper-faint">{config.model?.name || config.modelId}</span>
                                    <span className="mt-2 inline-flex rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper-muted">
                                        {enabledCount} capabilities
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="rounded-xs border border-ink-500 bg-ink-100">
                    <div className="border-b border-ink-500 px-4 py-3">
                        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim">Capabilities</h3>
                    </div>
                    <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                        {CAPABILITY_OPTIONS.map((capability) => {
                            const selected = selectedCapabilities.includes(capability.id);
                            const owner = capabilityOwners.get(capability.id);
                            return (
                                <button
                                    key={capability.id}
                                    type="button"
                                    onClick={() => toggleCapability(capability.id)}
                                    className={`min-h-24 rounded-xs border p-3 text-left transition-colors ${selected ? 'border-brand/50 bg-brand/10' : 'border-ink-500 bg-ink-200 hover:bg-ink-300/40'}`}
                                >
                                    <span className="flex items-start justify-between gap-2">
                                        <span>
                                            <span className="block text-[13px] font-medium text-paper">{capability.label}</span>
                                            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">{capability.id}</span>
                                        </span>
                                        <span className={`grid h-5 w-5 place-items-center rounded-xs border ${selected ? 'border-brand bg-brand text-ink-50' : 'border-ink-500 text-transparent'}`}>
                                            <Check className="h-3 w-3" />
                                        </span>
                                    </span>
                                    <span className="mt-3 block truncate text-[11px] text-paper-muted">
                                        {owner ? owner.config.name : 'Default routing'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            </div>

            {selectedCapabilities.length > 0 && (
                <section className="rounded-xs border border-ink-500 bg-ink-100">
                    <div className="flex flex-col gap-3 border-b border-ink-500 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-[14px] font-semibold text-paper">{selectedConfig?.name}</h3>
                            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{selectedCapabilities.length} selected capabilities</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {selectedCapabilities.map((capabilityId) => (
                                <Button
                                    key={capabilityId}
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setActiveCapabilityId(capabilityId)}
                                    className={`h-8 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.12em] ${activeCapabilityId === capabilityId ? 'bg-brand/10 text-brand' : 'text-paper-muted hover:bg-ink-200 hover:text-paper'}`}
                                >
                                    {capabilityId}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="p-4">
                        <Tabs defaultValue="routing" className="w-full">
                            <TabsList className="grid h-auto w-full grid-cols-3 rounded-xs border border-ink-500 bg-ink-200 p-1">
                                <TabsTrigger value="routing" className="gap-2 rounded-xs font-mono text-[10px] uppercase tracking-[0.12em] data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                                    <Route className="h-3.5 w-3.5" /> Routing
                                </TabsTrigger>
                                <TabsTrigger value="limits" className="gap-2 rounded-xs font-mono text-[10px] uppercase tracking-[0.12em] data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                                    <ShieldCheck className="h-3.5 w-3.5" /> Limits
                                </TabsTrigger>
                                <TabsTrigger value="advanced" className="gap-2 rounded-xs font-mono text-[10px] uppercase tracking-[0.12em] data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                                    <Sliders className="h-3.5 w-3.5" /> Advanced
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="routing" className="mt-4 space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Priority</span>
                                        <Input value={activeDraft.priority} onChange={(e) => updateActiveDraft({ priority: Number(e.target.value) || 0 })} type="number" min={0} className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Temperature</span>
                                        <Input value={activeDraft.temperature ?? ''} onChange={(e) => updateActiveDraft({ temperature: nullableNumber(e.target.value) })} type="number" min={0} max={2} step="0.1" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                </div>
                                <div>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Fallback order</span>
                                        <span className="text-[11px] text-paper-faint">{activeDraft.fallbackConfigIdsText.split(',').filter((id) => id.trim()).length} selected</span>
                                    </div>
                                    {fallbackOptions.length === 0 ? (
                                        <div className="rounded-xs border border-dashed border-ink-500 bg-ink-200 px-3 py-6 text-center text-[12px] text-paper-muted">No other active deployments.</div>
                                    ) : (
                                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                            {fallbackOptions.map((fallback) => {
                                                const checked = activeDraft.fallbackConfigIdsText.split(',').map((id) => id.trim()).includes(fallback.id);
                                                return (
                                                    <label key={fallback.id} className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2">
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-[12px] font-medium text-paper">{fallback.name}</span>
                                                            <span className="block truncate text-[11px] text-paper-faint">{fallback.model?.name || fallback.modelId}</span>
                                                        </span>
                                                        <Switch checked={checked} onCheckedChange={(next) => toggleFallback(fallback.id, next)} disabled={!canEdit} />
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="limits" className="mt-4">
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Max output tokens</span>
                                        <Input value={activeDraft.maxOutputTokens ?? ''} onChange={(e) => updateActiveDraft({ maxOutputTokens: nullableNumber(e.target.value) })} type="number" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Stop steps</span>
                                        <Input value={activeDraft.stopAtSteps ?? ''} onChange={(e) => updateActiveDraft({ stopAtSteps: nullableNumber(e.target.value) })} type="number" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Context messages</span>
                                        <Input value={activeDraft.maxContextMessages ?? ''} onChange={(e) => updateActiveDraft({ maxContextMessages: nullableNumber(e.target.value) })} type="number" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Max tool calls</span>
                                        <Input value={activeDraft.maxToolCalls ?? ''} onChange={(e) => updateActiveDraft({ maxToolCalls: nullableNumber(e.target.value) })} type="number" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Max result rows</span>
                                        <Input value={activeDraft.maxResultRows ?? ''} onChange={(e) => updateActiveDraft({ maxResultRows: nullableNumber(e.target.value) })} type="number" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                    <label className="space-y-1.5">
                                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Max runtime ms</span>
                                        <Input value={activeDraft.maxRuntimeMs ?? ''} onChange={(e) => updateActiveDraft({ maxRuntimeMs: nullableNumber(e.target.value) })} type="number" placeholder="Default" className="rounded-xs border-ink-500 bg-ink-200 text-paper" />
                                    </label>
                                </div>
                            </TabsContent>

                            <TabsContent value="advanced" className="mt-4 grid gap-3 lg:grid-cols-2">
                                <label className="space-y-1.5">
                                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Provider options JSON</span>
                                    <Textarea value={activeDraft.providerOptionsText} onChange={(e) => updateActiveDraft({ providerOptionsText: e.target.value })} placeholder='{"openai":{"reasoningEffort":"low"}}' className="min-h-36 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper" />
                                </label>
                                <label className="space-y-1.5">
                                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Fallback deployment ids</span>
                                    <Textarea value={activeDraft.fallbackConfigIdsText} onChange={(e) => updateActiveDraft({ fallbackConfigIdsText: e.target.value })} className="min-h-36 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper" />
                                </label>
                            </TabsContent>
                        </Tabs>
                    </div>

                    <div className="flex items-center justify-end border-t border-ink-500 px-4 py-3">
                        <Button type="button" onClick={save} disabled={!canEdit || isSaving || selectedCapabilities.length === 0} className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save policies
                        </Button>
                    </div>
                </section>
            )}
        </div>
    );
}
