import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { format, lastDayOfMonth, startOfMonth } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { MobileActionMenu } from '../../components/ui/MobileActionMenu';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  downloadCsv,
  formatCurrency,
  getMonthInputValue,
  isMissingTableError,
  writeActivityLog,
} from '../../lib/admin';
import { AdminAlertsData, fetchAdminAlerts, getCachedAdminAlerts } from '../../lib/adminAlerts';
import { getCachedAdminData, invalidateAdminDataCache, setCachedAdminData } from '../../lib/adminDataCache';
import { supabase } from '../../lib/supabase';

type ExpenseRecord = {
  id: string;
  description: string;
  amount: number | string;
  expense_date: string;
  category: string;
};

type TenantOption = {
  id: string;
  name: string;
};

const INITIAL_FORM_STATE = {
  description: '',
  amount: '',
  expense_date: new Date().toISOString().split('T')[0],
  category: '',
};
const EXPENSES_CACHE_KEY = 'expenses-page';

export const Expenses = () => {
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const { selectedPropertyId } = useAdminProperty();
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [formError, setFormError] = useState('');
  const [schemaReady, setSchemaReady] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(getMonthInputValue(new Date()));
  const [alerts, setAlerts] = useState<AdminAlertsData>({ unpaidTenants: [], expiringTenants: [] });
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [distributeToTenants, setDistributeToTenants] = useState(false);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const formCardRef = useRef<HTMLDivElement>(null);

  const fetchExpenses = useCallback(async () => {
    const cached = getCachedAdminData<{
      expenses: ExpenseRecord[];
      schemaReady: boolean;
    }>(EXPENSES_CACHE_KEY);

    if (cached) {
      setExpenses(cached.expenses);
      setSchemaReady(cached.schemaReady);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setFetchError('');

    const { data, error } = await supabase
      .from('expenses')
      .select('id, description, amount, expense_date, category')
      .order('expense_date', { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        setSchemaReady(false);
        setExpenses([]);
        setCachedAdminData(EXPENSES_CACHE_KEY, {
          expenses: [],
          schemaReady: false,
        });
        setLoading(false);
        return;
      }

      console.error('Expense fetch error:', error);
      setFetchError(error.message || 'Unable to load expenses.');
      setLoading(false);
      return;
    }

    setSchemaReady(true);
    setExpenses((data ?? []) as ExpenseRecord[]);
    
    if (selectedPropertyId) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('id, name')
        .eq('property_id', selectedPropertyId)
        .eq('is_active', true)
        .order('name');
      if (tenantData) {
        setTenants(tenantData as TenantOption[]);
      }
    }

    setCachedAdminData(EXPENSES_CACHE_KEY, {
      expenses: (data ?? []) as ExpenseRecord[],
      schemaReady: true,
    });
    setLoading(false);
  }, [selectedPropertyId]);

  useEffect(() => {
    void fetchExpenses();
  }, [fetchExpenses]);

  useEffect(() => {
    const cachedAlerts = getCachedAdminAlerts(selectedPropertyId);
    if (cachedAlerts) {
      setAlerts(cachedAlerts);
    }

    fetchAdminAlerts(selectedPropertyId)
      .then(setAlerts)
      .catch((error) => console.error('Expense alerts error:', error));
  }, [expenses, selectedPropertyId]);

  const selectedMonthStart = useMemo(() => startOfMonth(new Date(`${selectedMonth}-01`)), [selectedMonth]);
  const selectedMonthEnd = useMemo(() => lastDayOfMonth(selectedMonthStart), [selectedMonthStart]);
  const selectedMonthStartKey = useMemo(() => format(selectedMonthStart, 'yyyy-MM-dd'), [selectedMonthStart]);
  const selectedMonthEndKey = useMemo(() => format(selectedMonthEnd, 'yyyy-MM-dd'), [selectedMonthEnd]);

  const monthlyExpenses = useMemo(() => (
    expenses.filter((expense) => (
      expense.expense_date >= selectedMonthStartKey &&
      expense.expense_date <= selectedMonthEndKey
    ))
  ), [expenses, selectedMonthEndKey, selectedMonthStartKey]);

  const totalMonthlyExpenses = useMemo(() => (
    monthlyExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
  ), [monthlyExpenses]);

  const expenseCategories = useMemo(() => (
    settings.expense_categories
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
  ), [settings.expense_categories]);

  const handleSaveExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');

    const parsedAmount = Number(formData.amount);
    if (!formData.description.trim()) {
      setFormError('Please enter an expense description.');
      return;
    }
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid expense amount.');
      return;
    }
    if (!formData.expense_date) {
      setFormError('Please select an expense date.');
      return;
    }
    if (!formData.category.trim()) {
      setFormError('Please select an expense category.');
      return;
    }

    let savedExpenseId = editingExpenseId;
    if (editingExpenseId) {
      const { error } = await supabase
        .from('expenses')
        .update({
          description: formData.description.trim(),
          amount: parsedAmount,
          expense_date: formData.expense_date,
          category: formData.category.trim(),
        })
        .eq('id', editingExpenseId);
      if (error) {
        console.error('Expense update error:', error);
        setFormError(error.message || 'Unable to update the expense.');
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('expenses')
        .insert([{
          description: formData.description.trim(),
          amount: parsedAmount,
          expense_date: formData.expense_date,
          category: formData.category.trim(),
        }])
        .select('id')
        .single();
      if (error) {
        console.error('Expense insert error:', error);
        setFormError(error.message || 'Unable to save the expense.');
        return;
      }
      savedExpenseId = data.id;
    }

    if (distributeToTenants && selectedTenants.length > 0) {
       const chargeAmount = parsedAmount / selectedTenants.length;
       const billingMonthStart = startOfMonth(new Date(formData.expense_date));
       const billingMonthStr = format(billingMonthStart, 'yyyy-MM-dd');
       
       if (editingExpenseId) {
         await supabase.from('tenant_charges').delete().eq('expense_id', editingExpenseId);
       }
       
       const charges = selectedTenants.map((tId) => ({
          tenant_id: tId,
          expense_id: savedExpenseId,
          amount: chargeAmount,
          billing_month: billingMonthStr
       }));
       
       const { error: chargeError } = await supabase.from('tenant_charges').insert(charges);
       if (chargeError) {
          console.error('Charge insert error:', chargeError);
       }
    } else if (editingExpenseId) {
       await supabase.from('tenant_charges').delete().eq('expense_id', editingExpenseId);
    }

    await writeActivityLog({
      action: editingExpenseId ? 'expense.updated' : 'expense.created',
      entityType: 'expense',
      entityId: savedExpenseId ?? editingExpenseId ?? '',
      description: editingExpenseId 
        ? `Updated expense "${formData.description.trim()}" in ${formData.category.trim()}.`
        : `Recorded expense "${formData.description.trim()}" for ${formatCurrency(parsedAmount)} in ${formData.category.trim()}.`,
      actorId: user?.id,
    });

    invalidateAdminDataCache();
    setFormData(INITIAL_FORM_STATE);
    setEditingExpenseId(null);
    setShowForm(false);
    setDistributeToTenants(false);
    setSelectedTenants([]);
    await fetchExpenses();
  };

  const handleEditExpense = async (expense: ExpenseRecord) => {
    setEditingExpenseId(expense.id);
    setShowForm(true);
    setFormError('');
    setFormData({
      description: expense.description,
      amount: String(expense.amount),
      expense_date: expense.expense_date,
      category: expense.category,
    });

    const { data: charges } = await supabase
      .from('tenant_charges')
      .select('tenant_id')
      .eq('expense_id', expense.id);

    if (charges && charges.length > 0) {
      setDistributeToTenants(true);
      setSelectedTenants(charges.map((c) => c.tenant_id));
    } else {
      setDistributeToTenants(false);
      setSelectedTenants([]);
    }

    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleDeleteExpense = async (expenseId: string) => {
    const expense = expenses.find((item) => item.id === expenseId);
    if (!expense) return;
    
    const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
    if (error) {
      console.error('Expense delete error:', error);
      setFormError(error.message || 'Unable to delete expense record.');
      return;
    }

    await writeActivityLog({
      action: 'expense.deleted',
      entityType: 'expense',
      entityId: expenseId,
      description: `Deleted expense "${expense.description}".`,
      actorId: user?.id,
    });

    invalidateAdminDataCache();
    if (editingExpenseId === expenseId) {
      setEditingExpenseId(null);
      setShowForm(false);
      setFormData(INITIAL_FORM_STATE);
      setDistributeToTenants(false);
      setSelectedTenants([]);
    }

    await fetchExpenses();
  };

  const exportExpensesCsv = () => {
    downloadCsv(
      `expenses-${selectedMonth}.csv`,
      ['Date', 'Category', 'Description', 'Amount'],
      monthlyExpenses.map((expense) => [
        expense.expense_date,
        expense.category,
        expense.description,
        Number(expense.amount),
      ]),
    );
  };

  if (loading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading expenses...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are collecting this month&apos;s expense records now.</p>
        </Card>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="page-container">
        <Card style={{ borderColor: 'rgba(239, 68, 68, 0.35)' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Unable to load expenses</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{fetchError}</p>
          <Button onClick={() => void fetchExpenses()}>Retry</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Track monthly spending and keep your operating costs visible beside rent collections.</p>
        </div>
        <div className="admin-toolbar">
          <Button className="desktop-only" variant="secondary" onClick={exportExpensesCsv}>
            <Download size={16} /> Export CSV
          </Button>
          <MobileActionMenu
            items={[
              { label: 'Export CSV', onClick: exportExpensesCsv },
            ]}
          />
          <Button onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Cancel' : <><Plus size={18} /> Add Expense</>}
          </Button>
        </div>
      </div>

      {!schemaReady && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Expenses table needs one SQL migration</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Run the SQL migration for `public.expenses` first, then this page will start saving and listing records normally.
          </p>
        </Card>
      )}

      {expenseCategories.length === 0 && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Add expense categories in Settings</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            The expense form now uses a dropdown. Add one or more categories on the Settings page to start recording expenses.
          </p>
        </Card>
      )}

      {(alerts.unpaidTenants.length > 0 || alerts.expiringTenants.length > 0) && (
        <Card style={{ marginBottom: '1rem', borderColor: 'rgba(245, 158, 11, 0.35)', padding: '0.9rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ color: 'var(--text-secondary)' }}>
              {alerts.unpaidTenants.length > 0 ? `${alerts.unpaidTenants.length} unpaid or partial this month. ` : ''}
              {alerts.expiringTenants.length > 0 ? `${alerts.expiringTenants.length} expiring within 7 days.` : ''}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {alerts.unpaidTenants.length > 0 ? <span className="badge badge-danger">{alerts.unpaidTenants.length} Unpaid</span> : null}
              {alerts.expiringTenants.length > 0 ? <span className="badge badge-warning">{alerts.expiringTenants.length} Expiring</span> : null}
            </div>
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Input
              type="month"
              label="Month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            />
          </div>
          <div style={{ padding: '1rem 1.1rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Total Expenses</div>
            <h2 style={{ marginTop: '0.5rem', color: 'var(--danger)' }}>{formatCurrency(totalMonthlyExpenses)}</h2>
          </div>
          <div style={{ padding: '1rem 1.1rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Entries</div>
            <h2 style={{ marginTop: '0.5rem' }}>{monthlyExpenses.length}</h2>
          </div>
        </div>
      </Card>

      {showForm && (
        <Card ref={formCardRef} style={{ marginBottom: '1.5rem', borderColor: editingExpenseId ? 'var(--primary)' : undefined }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ marginBottom: '0.35rem' }}>{editingExpenseId ? 'Edit Expense' : 'Record Expense'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {editingExpenseId ? 'You are editing the selected expense record.' : 'Add a dated expense entry for the selected business category.'}
              </p>
            </div>
            {editingExpenseId && (
              <div className="badge badge-warning">
                Editing Mode
              </div>
            )}
          </div>
          <form onSubmit={handleSaveExpense} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'end' }}>
            <Input
              label="Description"
              required
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
            />
            <Input
              type="number"
              label="Amount"
              required
              value={formData.amount}
              onChange={(event) => setFormData({ ...formData, amount: event.target.value })}
            />
            <Input
              type="date"
              label="Date"
              required
              value={formData.expense_date}
              onChange={(event) => setFormData({ ...formData, expense_date: event.target.value })}
            />
            <div className="form-group">
              <label className="form-label">Category</label>
              <select
                className="form-select"
                required
                value={formData.category}
                onChange={(event) => setFormData({ ...formData, category: event.target.value })}
              >
                <option value="">Select category</option>
                {expenseCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            {formError && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--danger)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}>
                {formError}
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="distribute_toggle"
                  checked={distributeToTenants}
                  onChange={(e) => {
                    const isChecked = e.target.checked;
                    setDistributeToTenants(isChecked);
                    if (isChecked && !editingExpenseId) {
                      setSelectedTenants(tenants.map((t) => t.id));
                    } else if (!isChecked) {
                      setSelectedTenants([]);
                    }
                  }}
                  style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                />
                <label htmlFor="distribute_toggle" style={{ cursor: 'pointer', margin: 0, fontWeight: 600 }}>
                  Distribute charge equally to selected tenants
                </label>
              </div>
              
              {distributeToTenants && (
                <div style={{ padding: '1rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', background: 'rgba(255,255,255,0.02)' }}>
                   {tenants.map((t) => (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                         <input
                           type="checkbox"
                           id={`tenant_${t.id}`}
                           checked={selectedTenants.includes(t.id)}
                           onChange={(e) => {
                             if (e.target.checked) setSelectedTenants([...selectedTenants, t.id]);
                             else setSelectedTenants(selectedTenants.filter((id) => id !== t.id));
                           }}
                           style={{ cursor: 'pointer' }}
                         />
                         <label htmlFor={`tenant_${t.id}`} style={{ margin: 0, fontSize: '0.875rem', cursor: 'pointer' }}>{t.name}</label>
                      </div>
                   ))}
                   {tenants.length === 0 && (
                     <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No active tenants found.</span>
                   )}
                </div>
              )}
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button type="submit" disabled={!schemaReady || expenseCategories.length === 0}>
                  {editingExpenseId ? 'Update Expense' : 'Save Expense'}
                </Button>
                {editingExpenseId && (
                  <Button type="button" variant="secondary" onClick={() => {
                    setEditingExpenseId(null);
                    setFormData(INITIAL_FORM_STATE);
                    setDistributeToTenants(false);
                    setSelectedTenants([]);
                    setShowForm(false);
                  }}>Cancel</Button>
                )}
              </div>
            </div>
          </form>
        </Card>
      )}

      <Card style={{ overflowX: 'auto' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: '0.35rem' }}>Expenses For {format(selectedMonthStart, 'MMMM yyyy')}</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Latest expense records for the selected month.</p>
        </div>
        {monthlyExpenses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--text-secondary)' }}>
            No expense entries were recorded for this month.
          </div>
        ) : (
          <div style={{ minWidth: '720px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1.2fr 1fr 1fr auto', padding: '0 1rem 0.85rem', borderBottom: '1px solid var(--border-light)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem' }}>
              <div>Description</div>
              <div>Category</div>
              <div>Date</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div style={{ textAlign: 'right', paddingLeft: '1.5rem' }}>Actions</div>
            </div>
            {monthlyExpenses.map((expense) => (
              <div
                key={expense.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2.2fr 1.2fr 1fr 1fr auto',
                  gap: '1rem',
                  padding: '0.9rem 1rem',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{expense.description}</div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{expense.category}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{format(new Date(expense.expense_date), 'MMM dd, yyyy')}</div>
                <div style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(Number(expense.amount))}</div>
                <div style={{ justifySelf: 'end', display: 'flex', gap: '0.5rem' }}>
                  <Button variant="secondary" onClick={() => handleEditExpense(expense)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem', height: 'auto' }}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => handleDeleteExpense(expense.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem', height: 'auto' }}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
