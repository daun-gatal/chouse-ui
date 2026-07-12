import { Plus, Trash2 } from "lucide-react";

import type { DataHealthCheck, DataHealthColumn } from "@/api/dataHealth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DH_LABEL } from "./lib";

export interface CompletenessRule {
  checkKey: string;
  column: string;
  minPercent: number;
}

export interface UniquenessRule {
  checkKey: string;
  columns: string[];
  maxDuplicatePercent: number;
}

export interface ValidityRule {
  checkKey: string;
  name: string;
  predicate: string;
  minPercent: number;
}

export interface CustomMetricRule {
  checkKey: string;
  name: string;
  expression: string;
  operator: Extract<DataHealthCheck, { type: "custom_metric" }>["config"]["operator"];
  threshold: number;
  upperThreshold: number;
}

const CUSTOM_OPERATORS: CustomMetricRule["operator"][] = ["gt", "gte", "lt", "lte", "eq", "between"];

function isCustomOperator(value: string): value is CustomMetricRule["operator"] {
  return CUSTOM_OPERATORS.some((operator) => operator === value);
}

interface RuleSectionProps {
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}

function RuleSection({ title, description, addLabel, onAdd, children }: RuleSectionProps): React.ReactElement {
  return (
    <section className="rounded-xs border border-ink-500 bg-ink-200/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-paper">{title}</p>
          <p className="mt-0.5 text-[10px] text-paper-muted">{description}</p>
        </div>
        <Button type="button" variant="outline" className="h-8 rounded-xs text-[10px]" onClick={onAdd}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> {addLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={label} onClick={onClick}>
      <Trash2 className="h-3.5 w-3.5 text-red-500" />
    </Button>
  );
}

interface RuleEditorsProps {
  columns: DataHealthColumn[];
  completenessRules: CompletenessRule[];
  uniquenessRules: UniquenessRule[];
  validityRules: ValidityRule[];
  customMetricRules: CustomMetricRule[];
  onCompletenessRulesChange: (rules: CompletenessRule[]) => void;
  onUniquenessRulesChange: (rules: UniquenessRule[]) => void;
  onValidityRulesChange: (rules: ValidityRule[]) => void;
  onCustomMetricRulesChange: (rules: CustomMetricRule[]) => void;
  createKey: (prefix: string) => string;
}

export function RuleEditors({
  columns,
  completenessRules,
  uniquenessRules,
  validityRules,
  customMetricRules,
  onCompletenessRulesChange,
  onUniquenessRulesChange,
  onValidityRulesChange,
  onCustomMetricRulesChange,
  createKey,
}: RuleEditorsProps): React.ReactElement {
  const updateCompleteness = (index: number, patch: Partial<CompletenessRule>): void => {
    onCompletenessRulesChange(completenessRules.map((rule, position) => position === index ? { ...rule, ...patch } : rule));
  };
  const updateUniqueness = (index: number, patch: Partial<UniquenessRule>): void => {
    onUniquenessRulesChange(uniquenessRules.map((rule, position) => position === index ? { ...rule, ...patch } : rule));
  };
  const updateValidity = (index: number, patch: Partial<ValidityRule>): void => {
    onValidityRulesChange(validityRules.map((rule, position) => position === index ? { ...rule, ...patch } : rule));
  };
  const updateCustom = (index: number, patch: Partial<CustomMetricRule>): void => {
    onCustomMetricRulesChange(customMetricRules.map((rule, position) => position === index ? { ...rule, ...patch } : rule));
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <RuleSection
        title="Column completeness"
        description="Add independent minimum-completeness promises for the columns that matter."
        addLabel="Add column"
        onAdd={() => onCompletenessRulesChange([...completenessRules, { checkKey: createKey("complete"), column: "", minPercent: 99.9 }])}
      >
        <div className="mt-3 space-y-2">
          {completenessRules.map((rule, index) => (
            <div key={rule.checkKey} className="flex items-end gap-2 rounded-xs border border-ink-500 p-2">
              <div className="min-w-0 flex-1">
                <Label>Column</Label>
                {columns.length > 0 ? (
                  <Select value={rule.column || "none"} onValueChange={(value) => updateCompleteness(index, { column: value === "none" ? "" : value })}>
                    <SelectTrigger className="mt-1 rounded-xs"><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">Select column</SelectItem>{columns.map((column) => <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Input value={rule.column} onChange={(event) => updateCompleteness(index, { column: event.target.value })} placeholder="customer_id" className="mt-1 rounded-xs font-mono" />}
              </div>
              <div className="w-32">
                <Label>Minimum %</Label>
                <Input type="number" min={0} max={100} step={0.1} value={rule.minPercent} onChange={(event) => updateCompleteness(index, { minPercent: Number(event.target.value) })} className="mt-1 rounded-xs" />
              </div>
              <RemoveButton label={`Remove completeness rule ${index + 1}`} onClick={() => onCompletenessRulesChange(completenessRules.filter((_, position) => position !== index))} />
            </div>
          ))}
          {completenessRules.length === 0 && <p className="py-2 text-[10px] text-paper-faint">No completeness promises.</p>}
        </div>
      </RuleSection>

      <RuleSection
        title="Key uniqueness"
        description="Each rule can use one column or a composite key; add another rule for another business key."
        addLabel="Add key rule"
        onAdd={() => onUniquenessRulesChange([...uniquenessRules, { checkKey: createKey("unique"), columns: [], maxDuplicatePercent: 0 }])}
      >
        <div className="mt-3 space-y-2">
          {uniquenessRules.map((rule, index) => (
            <div key={rule.checkKey} className="rounded-xs border border-ink-500 p-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className={DH_LABEL}>Composite key columns</p>
                  {columns.length > 0 ? (
                    <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                      {columns.map((column) => <label key={column.name} className="flex items-center gap-1.5 rounded-xs border border-ink-500 px-2 py-1 text-[10px] text-paper-muted"><Checkbox checked={rule.columns.includes(column.name)} disabled={!rule.columns.includes(column.name) && rule.columns.length >= 10} onCheckedChange={(checked) => updateUniqueness(index, { columns: checked === true ? [...rule.columns, column.name] : rule.columns.filter((name) => name !== column.name) })} />{column.name}</label>)}
                    </div>
                  ) : <Input value={rule.columns.join(", ")} onChange={(event) => updateUniqueness(index, { columns: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="account_id, event_id" className="mt-1 rounded-xs font-mono" />}
                </div>
                <RemoveButton label={`Remove uniqueness rule ${index + 1}`} onClick={() => onUniquenessRulesChange(uniquenessRules.filter((_, position) => position !== index))} />
              </div>
              <div className="mt-2 w-44"><Label>Maximum duplicates %</Label><Input type="number" min={0} max={100} step={0.01} value={rule.maxDuplicatePercent} onChange={(event) => updateUniqueness(index, { maxDuplicatePercent: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
            </div>
          ))}
          {uniquenessRules.length === 0 && <p className="py-2 text-[10px] text-paper-faint">No uniqueness promises.</p>}
        </div>
      </RuleSection>

      <RuleSection
        title="Business-rule validity"
        description="Add separate predicates when each rule needs its own valid-row target."
        addLabel="Add validity rule"
        onAdd={() => onValidityRulesChange([...validityRules, { checkKey: createKey("valid"), name: "Business-rule validity", predicate: "", minPercent: 99 }])}
      >
        <div className="mt-3 space-y-2">
          {validityRules.map((rule, index) => (
            <div key={rule.checkKey} className="rounded-xs border border-ink-500 p-2">
              <div className="flex gap-2"><Input value={rule.name} onChange={(event) => updateValidity(index, { name: event.target.value })} placeholder="Valid payment states" className="rounded-xs" /><RemoveButton label={`Remove validity rule ${index + 1}`} onClick={() => onValidityRulesChange(validityRules.filter((_, position) => position !== index))} /></div>
              <Input value={rule.predicate} onChange={(event) => updateValidity(index, { predicate: event.target.value })} placeholder="amount >= 0 AND status != 'invalid'" className="mt-2 rounded-xs font-mono" />
              <div className="mt-2 w-40"><Label>Minimum valid %</Label><Input type="number" min={0} max={100} step={0.1} value={rule.minPercent} onChange={(event) => updateValidity(index, { minPercent: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
            </div>
          ))}
          {validityRules.length === 0 && <p className="py-2 text-[10px] text-paper-faint">No business-rule promises.</p>}
        </div>
      </RuleSection>

      <RuleSection
        title="Custom scalar metrics"
        description="Track multiple domain aggregates, each with its own operator and threshold."
        addLabel="Add metric"
        onAdd={() => onCustomMetricRulesChange([...customMetricRules, { checkKey: createKey("metric"), name: "Custom metric", expression: "", operator: "gte", threshold: 0, upperThreshold: 0 }])}
      >
        <div className="mt-3 space-y-2">
          {customMetricRules.map((rule, index) => (
            <div key={rule.checkKey} className="rounded-xs border border-ink-500 p-2">
              <div className="flex gap-2"><Input value={rule.name} onChange={(event) => updateCustom(index, { name: event.target.value })} placeholder="Successful payments" className="rounded-xs" /><RemoveButton label={`Remove custom metric ${index + 1}`} onClick={() => onCustomMetricRulesChange(customMetricRules.filter((_, position) => position !== index))} /></div>
              <Input value={rule.expression} onChange={(event) => updateCustom(index, { expression: event.target.value })} placeholder="countIf(payment_state = 'paid')" className="mt-2 rounded-xs font-mono" />
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div><Label>Operator</Label><Select value={rule.operator} onValueChange={(value) => { if (isCustomOperator(value)) updateCustom(index, { operator: value }); }}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gte">≥</SelectItem><SelectItem value="gt">&gt;</SelectItem><SelectItem value="lte">≤</SelectItem><SelectItem value="lt">&lt;</SelectItem><SelectItem value="eq">=</SelectItem><SelectItem value="between">Between</SelectItem></SelectContent></Select></div>
                <div><Label>{rule.operator === "between" ? "Minimum" : "Threshold"}</Label><Input type="number" value={rule.threshold} onChange={(event) => updateCustom(index, { threshold: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
                {rule.operator === "between" && <div><Label>Maximum</Label><Input type="number" value={rule.upperThreshold} onChange={(event) => updateCustom(index, { upperThreshold: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>}
              </div>
            </div>
          ))}
          {customMetricRules.length === 0 && <p className="py-2 text-[10px] text-paper-faint">No custom metrics.</p>}
        </div>
      </RuleSection>
    </div>
  );
}
