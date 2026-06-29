'use client';

import type { Dispatch, Ref, SetStateAction } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ProductFormMode = 'add' | 'edit' | 'new_product_review';

export type ProductFormState = {
  upc: string;
  plu: string;
  productCode: string;
  sku: string;
  name: string;
  department: string;
  customDepartment: string;
  category: string;
  brand: string;
  vendor: string;
  customVendor: string;
  costPrice: string;
  sellPrice: string;
  stock: string;
  reorderLevel: string;
  unitsPerCase: string;
  casesOnHand: string;
  looseUnits: string;
  taxCategory: string;
  taxRate: string;
  taxable: boolean;
  ebtEligible: boolean;
  ageVerification: boolean;
  minimumAge: string;
  ageRestrictionType: string;
  customAgeRestrictionType: string;
  isActive: boolean;
  notes: string;
};

type ProductDuplicateMatch = {
  name: string;
};

type TaxCategoryOption = {
  id: string;
  name: string;
  rate: number;
  is_active: boolean;
};

type AgeRestrictionOption = {
  id: string;
  name: string;
  minimum_age: number;
  restriction_type: string;
  is_active: boolean;
};

type ProductFormFieldErrors = {
  upc?: string;
  name?: string;
};

type ProductFormProps = {
  mode: ProductFormMode;
  form: ProductFormState;
  setForm: Dispatch<SetStateAction<ProductFormState>>;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  departmentOptions: string[];
  vendorOptions: string[];
  taxCategoryOptions: TaxCategoryOption[];
  ageRestrictionOptions: AgeRestrictionOption[];
  upcDuplicate: ProductDuplicateMatch | null;
  pluDuplicate: ProductDuplicateMatch | null;
  productCodeDuplicate: ProductDuplicateMatch | null;
  onUpcChange: (value: string) => void;
  onNameChange?: (value: string) => void;
  onUpcBlur: () => void;
  onPluBlur: () => void;
  onProductCodeBlur: () => void;
  writeBlocked?: boolean;
  disableUpc?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  fieldErrors?: ProductFormFieldErrors;
  upcHelperText?: string;
  upcInputRef?: Ref<HTMLInputElement>;
};

function safeNumber(value: string | number | null | undefined, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateStockFromCases(form: ProductFormState) {
  const unitsPerCase = Math.max(1, safeNumber(form.unitsPerCase, 1));
  const casesOnHand = Math.max(0, safeNumber(form.casesOnHand));
  const looseUnits = Math.max(0, safeNumber(form.looseUnits));

  return casesOnHand * unitsPerCase + looseUnits;
}

export function ProductForm({
  mode,
  form,
  setForm,
  onSubmit,
  onCancel,
  saving,
  error,
  departmentOptions,
  vendorOptions,
  taxCategoryOptions,
  ageRestrictionOptions,
  upcDuplicate,
  pluDuplicate,
  productCodeDuplicate,
  onUpcChange,
  onNameChange,
  onUpcBlur,
  onPluBlur,
  onProductCodeBlur,
  writeBlocked,
  disableUpc = mode === 'edit',
  submitLabel,
  cancelLabel = 'Cancel',
  fieldErrors,
  upcHelperText,
  upcInputRef,
}: ProductFormProps) {
  const selectedTax = taxCategoryOptions.find((tax) => tax.name === form.taxCategory);
  const selectedAge = ageRestrictionOptions.find(
    (preset) =>
      preset.restriction_type === form.ageRestrictionType &&
      String(preset.minimum_age) === String(form.minimumAge || 21)
  );

  const fieldClass = 'h-8 px-2 py-1 text-sm';
  const selectClass =
    'h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';
  const labelClass = 'space-y-1';
  const labelTextClass = 'text-xs font-medium text-muted-foreground';
  const resolvedSubmitLabel =
    submitLabel ??
    (saving
      ? 'Saving...'
      : mode === 'new_product_review'
        ? 'Save Product'
        : mode === 'add'
        ? upcDuplicate
          ? 'Update Existing Product'
          : 'Add Product'
        : 'Save Changes');
  const updateField = <K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const updateFields = (patch: Partial<ProductFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  return (
    <>
      <div className="overflow-y-auto px-4 py-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>UPC *</span>
              <Input
                ref={upcInputRef}
                className={fieldClass}
                value={form.upc}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  updateField('upc', nextValue);
                  onUpcChange(nextValue);
                }}
                onBlur={onUpcBlur}
                disabled={disableUpc}
                placeholder="0120000010101"
                aria-invalid={Boolean(fieldErrors?.upc)}
              />
              {upcHelperText && <span className="text-xs text-muted-foreground">{upcHelperText}</span>}
              {fieldErrors?.upc && <span className="text-xs font-medium text-destructive">{fieldErrors.upc}</span>}
              {upcDuplicate && mode === 'add' && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  This UPC already exists: {upcDuplicate.name}. Saving will update it.
                </p>
              )}
            </label>

            <label className={labelClass}>
              <span className={labelTextClass}>PLU Code</span>
              <Input
                className={fieldClass}
                value={form.plu}
                onChange={(event) => updateField('plu', event.target.value)}
                onBlur={onPluBlur}
                placeholder="4011"
              />
              {pluDuplicate && mode === 'add' && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  This PLU already exists: {pluDuplicate.name}.
                </p>
              )}
            </label>
          </div>

          <label className={labelClass}>
            <span className={labelTextClass}>Product Name *</span>
            <Input
              className={fieldClass}
              value={form.name}
              onChange={(event) => {
                updateField('name', event.target.value);
                onNameChange?.(event.target.value);
              }}
              placeholder="Coca-Cola 20oz"
              aria-invalid={Boolean(fieldErrors?.name)}
            />
            {fieldErrors?.name && <span className="text-xs font-medium text-destructive">{fieldErrors.name}</span>}
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Product Code</span>
              <Input
                className={fieldClass}
                value={form.productCode}
                onChange={(event) => updateField('productCode', event.target.value)}
                onBlur={onProductCodeBlur}
                placeholder="Internal code"
              />
              {productCodeDuplicate && mode === 'add' && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  This product code already exists: {productCodeDuplicate.name}.
                </p>
              )}
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>SKU</span>
              <Input
                className={fieldClass}
                value={form.sku}
                onChange={(event) => updateField('sku', event.target.value)}
                placeholder="SKU"
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Department *</span>
              <select
                className={selectClass}
                value={
                  departmentOptions.includes(form.department)
                    ? form.department
                    : form.department
                      ? '__other__'
                      : ''
                }
                onChange={(event) =>
                  updateFields({
                    department: event.target.value,
                    customDepartment: event.target.value === '__other__' ? form.customDepartment : '',
                  })
                }
              >
                <option value="">Select department</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
                <option value="__other__">Other (type manually)</option>
              </select>
              {(form.department === '__other__' ||
                (form.department && !departmentOptions.includes(form.department))) && (
                <Input
                  className={fieldClass}
                  value={form.department === '__other__' ? form.customDepartment : form.department}
                  onChange={(event) =>
                    updateFields({ department: '__other__', customDepartment: event.target.value })
                  }
                  placeholder="Department name"
                />
              )}
            </label>

            <label className={labelClass}>
              <span className={labelTextClass}>Category</span>
              <Input
                className={fieldClass}
                value={form.category}
                onChange={(event) => updateField('category', event.target.value)}
                placeholder="Category"
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Brand</span>
              <Input
                className={fieldClass}
                value={form.brand}
                onChange={(event) => updateField('brand', event.target.value)}
                placeholder="Brand"
              />
            </label>

            <label className={labelClass}>
              <span className={labelTextClass}>Vendor</span>
              <select
                className={selectClass}
                value={vendorOptions.includes(form.vendor) ? form.vendor : form.vendor ? '__other__' : ''}
                onChange={(event) =>
                  updateFields({
                    vendor: event.target.value,
                    customVendor: event.target.value === '__other__' ? form.customVendor : '',
                  })
                }
              >
                <option value="">No vendor</option>
                {vendorOptions.map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
                <option value="__other__">Other (type manually)</option>
              </select>
              {(form.vendor === '__other__' || (form.vendor && !vendorOptions.includes(form.vendor))) && (
                <Input
                  className={fieldClass}
                  value={form.vendor === '__other__' ? form.customVendor : form.vendor}
                  onChange={(event) => updateFields({ vendor: '__other__', customVendor: event.target.value })}
                  placeholder="Vendor name"
                />
              )}
              <span className="text-xs text-muted-foreground">Manage vendors in Store Settings - Vendors</span>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Cost Price</span>
              <Input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(event) => updateField('costPrice', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Selling Price</span>
              <Input
                className={fieldClass}
                type="number"
                step="0.01"
                min="0"
                value={form.sellPrice}
                onChange={(event) => updateField('sellPrice', event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={labelTextClass}>Stock</span>
              <Input className={fieldClass} type="number" min="0" value={String(calculateStockFromCases(form))} readOnly />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Reorder Level</span>
              <Input
                className={fieldClass}
                type="number"
                min="0"
                value={form.reorderLevel}
                onChange={(event) => updateField('reorderLevel', event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className={labelClass}>
              <span className={labelTextClass}>Units Per Case</span>
              <Input
                className={fieldClass}
                type="number"
                min="1"
                value={form.unitsPerCase}
                onChange={(event) => updateField('unitsPerCase', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Cases On Hand</span>
              <Input
                className={fieldClass}
                type="number"
                min="0"
                value={form.casesOnHand}
                onChange={(event) => updateField('casesOnHand', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span className={labelTextClass}>Loose Units</span>
              <Input
                className={fieldClass}
                type="number"
                min="0"
                value={form.looseUnits}
                onChange={(event) => updateField('looseUnits', event.target.value)}
              />
            </label>
          </div>

          <div className="border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product Rules
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => updateField('isActive', event.target.checked)}
              />{' '}
              Active
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.taxable}
                onChange={(event) =>
                  updateFields({
                    taxable: event.target.checked,
                    taxCategory: event.target.checked ? form.taxCategory : 'non-taxable',
                    taxRate: event.target.checked ? form.taxRate : '0',
                  })
                }
              />{' '}
              Taxable
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.ebtEligible}
                onChange={(event) => updateField('ebtEligible', event.target.checked)}
              />{' '}
              EBT Eligible
            </label>
          </div>

          {form.taxable && (
            <div className="grid gap-2">
              <div className="border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tax
              </div>
              {taxCategoryOptions.length ? (
                <div className="flex flex-wrap gap-2">
                  {taxCategoryOptions.map((tax) => (
                    <button
                      key={tax.id}
                      type="button"
                      onClick={() => updateFields({ taxCategory: tax.name, taxRate: String(tax.rate) })}
                      className={cn(
                        'rounded-full border px-2 py-1 text-xs font-semibold transition',
                        selectedTax?.id === tax.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-secondary'
                      )}
                    >
                      {tax.name} {Number(tax.rate || 0).toFixed(Number(tax.rate || 0) % 1 === 0 ? 0 : 2)}%
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No tax categories found. Add them in Store Settings - Tax.
                </p>
              )}
            </div>
          )}

          <div className="border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Age Verification
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.ageVerification}
              onChange={(event) =>
                updateFields({
                  ageVerification: event.target.checked,
                  minimumAge: event.target.checked ? form.minimumAge || '21' : '',
                  ageRestrictionType: event.target.checked ? form.ageRestrictionType : '',
                  customAgeRestrictionType: '',
                })
              }
            />{' '}
            Age Verification Required
          </label>

          {form.ageVerification && (
            <div className="grid gap-2">
              {ageRestrictionOptions.length ? (
                <div className="flex flex-wrap gap-2">
                  {ageRestrictionOptions.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        updateFields({
                          ageRestrictionType: preset.restriction_type,
                          minimumAge: String(preset.minimum_age),
                          customAgeRestrictionType: '',
                        })
                      }
                      className={cn(
                        'rounded-full border px-2 py-1 text-xs font-semibold transition',
                        selectedAge?.id === preset.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-secondary'
                      )}
                    >
                      {preset.name} {preset.minimum_age}+
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No age restriction presets found. Add them in Store Settings - Age Restrictions.
                </p>
              )}
            </div>
          )}

          <label className={labelClass}>
            <span className={labelTextClass}>Notes</span>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(event) => updateField('notes', event.target.value)}
              placeholder="Optional product notes."
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </Button>
        <Button onClick={onSubmit} disabled={saving || writeBlocked}>
          {resolvedSubmitLabel}
        </Button>
      </div>
    </>
  );
}
