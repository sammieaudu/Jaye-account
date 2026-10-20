PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO migrations VALUES(1, datetime('now'));
INSERT OR IGNORE INTO migrations VALUES(2, datetime('now'));
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,name TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency IN ('USD','NGN')),country TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,entities TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS policies(entity_id TEXT PRIMARY KEY REFERENCES entities(id),cfo_threshold INTEGER NOT NULL CHECK(cfo_threshold>0),budget_alert_percent INTEGER NOT NULL DEFAULT 80);
CREATE TABLE IF NOT EXISTS periods(entity_id TEXT NOT NULL REFERENCES entities(id),period TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',PRIMARY KEY(entity_id,period));
CREATE TABLE IF NOT EXISTS accounts(entity_id TEXT NOT NULL REFERENCES entities(id),code TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(entity_id,code));
CREATE TABLE IF NOT EXISTS vendors(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),name TEXT NOT NULL,category TEXT NOT NULL,related_party INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'review_required',UNIQUE(id,entity_id));
CREATE TABLE IF NOT EXISTS budgets(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),department TEXT NOT NULL,category TEXT NOT NULL,period TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),UNIQUE(entity_id,department,category,period));
CREATE TABLE IF NOT EXISTS spends(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),kind TEXT NOT NULL CHECK(kind IN ('expense','bill','request')),vendor_id TEXT NOT NULL,description TEXT NOT NULL,purpose TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000),currency TEXT NOT NULL,department TEXT NOT NULL,category TEXT NOT NULL,date TEXT NOT NULL,invoice_number TEXT,parent_id TEXT REFERENCES spends(id),status TEXT NOT NULL DEFAULT 'draft',requester_id TEXT NOT NULL REFERENCES users(id),manager_id TEXT REFERENCES users(id),finance_id TEXT REFERENCES users(id),cfo_id TEXT REFERENCES users(id),payer_id TEXT REFERENCES users(id),reconciler_id TEXT REFERENCES users(id),payment_reference TEXT,reconciliation_reference TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(vendor_id,entity_id) REFERENCES vendors(id,entity_id),UNIQUE(id,entity_id));
CREATE UNIQUE INDEX IF NOT EXISTS invoice_unique ON spends(entity_id,vendor_id,invoice_number) WHERE invoice_number IS NOT NULL AND invoice_number<>'';
CREATE UNIQUE INDEX IF NOT EXISTS conversion_unique ON spends(parent_id) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_ref_unique ON spends(entity_id,payment_reference) WHERE payment_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_ref_unique ON spends(entity_id,reconciliation_reference) WHERE reconciliation_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS spends_entity_status ON spends(entity_id,status);
CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),spend_id TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,hash TEXT NOT NULL,storage_path TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,FOREIGN KEY(spend_id,entity_id) REFERENCES spends(id,entity_id));
CREATE TABLE IF NOT EXISTS journals(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),number INTEGER NOT NULL,year TEXT NOT NULL,date TEXT NOT NULL,description TEXT NOT NULL,source_id TEXT REFERENCES spends(id),idempotency_key TEXT NOT NULL,posted_by TEXT NOT NULL,approved_by TEXT NOT NULL,reversal_of TEXT REFERENCES journals(id),posted_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),UNIQUE(entity_id,year,number),UNIQUE(entity_id,idempotency_key));
CREATE TABLE IF NOT EXISTS lines(id INTEGER PRIMARY KEY AUTOINCREMENT,journal_id TEXT NOT NULL REFERENCES journals(id),entity_id TEXT NOT NULL,account TEXT NOT NULL,debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0),credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0),CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),FOREIGN KEY(entity_id,account) REFERENCES accounts(entity_id,code));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL REFERENCES entities(id),actor_id TEXT NOT NULL,action TEXT NOT NULL,resource_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS journal_immutable_update BEFORE UPDATE ON journals WHEN OLD.status='posted' BEGIN SELECT RAISE(ABORT,'Posted journals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_immutable_delete BEFORE DELETE ON journals WHEN OLD.status='posted' BEGIN SELECT RAISE(ABORT,'Posted journals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS line_immutable_update BEFORE UPDATE ON lines WHEN (SELECT status FROM journals WHERE id=OLD.journal_id)='posted' BEGIN SELECT RAISE(ABORT,'Posted lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS line_immutable_delete BEFORE DELETE ON lines WHEN (SELECT status FROM journals WHERE id=OLD.journal_id)='posted' BEGIN SELECT RAISE(ABORT,'Posted lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS line_entity BEFORE INSERT ON lines WHEN NEW.entity_id != (SELECT entity_id FROM journals WHERE id=NEW.journal_id) BEGIN SELECT RAISE(ABORT,'Journal entity mismatch'); END;
CREATE TRIGGER IF NOT EXISTS audit_immutable_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit log is append only'); END;
CREATE TRIGGER IF NOT EXISTS audit_immutable_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit log is append only'); END;
CREATE TRIGGER IF NOT EXISTS receipt_immutable_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS receipt_immutable_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS journal_must_start_draft BEFORE INSERT ON journals WHEN NEW.status<>'draft' BEGIN SELECT RAISE(ABORT,'Journals must be built as drafts'); END;
CREATE TRIGGER IF NOT EXISTS journal_posting_balance BEFORE UPDATE OF status ON journals WHEN NEW.status='posted' BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM lines WHERE journal_id=NEW.id)<2 THEN RAISE(ABORT,'At least two journal lines required') END;
 SELECT CASE WHEN (SELECT SUM(debit-credit) FROM lines WHERE journal_id=NEW.id)<>0 THEN RAISE(ABORT,'Journal must balance') END;
 SELECT CASE WHEN COALESCE((SELECT status FROM periods WHERE entity_id=NEW.entity_id AND period=substr(NEW.date,1,7)),'missing')<>'open' THEN RAISE(ABORT,'Period is not open') END;
 SELECT CASE WHEN length(NEW.approved_by)=0 THEN RAISE(ABORT,'Approval required') END;
END;
CREATE TRIGGER IF NOT EXISTS posted_lines_no_insert BEFORE INSERT ON lines WHEN (SELECT status FROM journals WHERE id=NEW.journal_id)='posted' BEGIN SELECT RAISE(ABORT,'Cannot add lines to posted journals'); END;
CREATE TRIGGER IF NOT EXISTS source_entity BEFORE INSERT ON journals WHEN NEW.source_id IS NOT NULL AND (SELECT entity_id FROM spends WHERE id=NEW.source_id)<>NEW.entity_id BEGIN SELECT RAISE(ABORT,'Source entity mismatch'); END;
CREATE TRIGGER IF NOT EXISTS inactive_account BEFORE INSERT ON lines WHEN (SELECT active FROM accounts WHERE entity_id=NEW.entity_id AND code=NEW.account)<>1 BEGIN SELECT RAISE(ABORT,'Inactive account'); END;
CREATE TABLE IF NOT EXISTS bank_transactions(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),reference TEXT NOT NULL,date TEXT NOT NULL,currency TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),description TEXT NOT NULL,matched_spend_id TEXT REFERENCES spends(id),imported_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(entity_id,reference),UNIQUE(matched_spend_id));
INSERT OR IGNORE INTO migrations VALUES(3, datetime('now'));

CREATE TABLE IF NOT EXISTS reimbursement_claims(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),claimant_id TEXT NOT NULL REFERENCES users(id),requester_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reimbursement_items(claim_id TEXT NOT NULL REFERENCES reimbursement_claims(id),spend_id TEXT PRIMARY KEY REFERENCES spends(id));
CREATE TABLE IF NOT EXISTS reimbursement_payments(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES reimbursement_claims(id),entity_id TEXT NOT NULL REFERENCES entities(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','paid','reconciled','posted','cancelled')),scheduled_by TEXT NOT NULL REFERENCES users(id),payer_id TEXT REFERENCES users(id),reconciler_id TEXT REFERENCES users(id),reference TEXT,created_at TEXT NOT NULL,UNIQUE(entity_id,reference));
CREATE TABLE IF NOT EXISTS reimbursement_allocations(payment_id TEXT NOT NULL REFERENCES reimbursement_payments(id),spend_id TEXT NOT NULL REFERENCES spends(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),PRIMARY KEY(payment_id,spend_id));
CREATE TABLE IF NOT EXISTS reimbursement_matches(bank_transaction_id TEXT PRIMARY KEY REFERENCES bank_transactions(id),payment_id TEXT NOT NULL UNIQUE REFERENCES reimbursement_payments(id));
CREATE TRIGGER IF NOT EXISTS reimbursement_payment_final_update BEFORE UPDATE ON reimbursement_payments WHEN OLD.status IN ('posted','cancelled') BEGIN SELECT RAISE(ABORT,'Final repayments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS reimbursement_payment_delete BEFORE DELETE ON reimbursement_payments BEGIN SELECT RAISE(ABORT,'Repayment history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS reimbursement_allocation_update BEFORE UPDATE ON reimbursement_allocations BEGIN SELECT RAISE(ABORT,'Repayment allocations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS reimbursement_allocation_delete BEFORE DELETE ON reimbursement_allocations BEGIN SELECT RAISE(ABORT,'Repayment allocations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS reimbursement_match_update BEFORE UPDATE ON reimbursement_matches BEGIN SELECT RAISE(ABORT,'Reconciliation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS reimbursement_match_delete BEFORE DELETE ON reimbursement_matches BEGIN SELECT RAISE(ABORT,'Reconciliation is immutable'); END;
INSERT OR IGNORE INTO migrations VALUES(5, datetime('now'));

CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),vendor_id TEXT NOT NULL REFERENCES vendors(id),owner_id TEXT NOT NULL REFERENCES users(id),created_by TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,purpose TEXT NOT NULL,plan TEXT NOT NULL,seats INTEGER NOT NULL CHECK(seats>0),department TEXT NOT NULL,category TEXT NOT NULL,currency TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),cadence TEXT NOT NULL CHECK(cadence IN ('monthly','annual','custom_days')),interval_count INTEGER NOT NULL CHECK(interval_count>0),billing_anchor TEXT NOT NULL,renewal_date TEXT NOT NULL,cancellation_deadline TEXT NOT NULL,auto_renew INTEGER NOT NULL DEFAULT 1,payment_method TEXT NOT NULL,payment_account TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscription_terms(id INTEGER PRIMARY KEY AUTOINCREMENT,subscription_id TEXT NOT NULL REFERENCES subscriptions(id),starts_on TEXT NOT NULL,ends_before TEXT,anchor TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),cadence TEXT NOT NULL,interval_count INTEGER NOT NULL CHECK(interval_count>0));
CREATE TABLE IF NOT EXISTS subscription_charges(id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES subscriptions(id),due_date TEXT NOT NULL,expected_minor INTEGER NOT NULL CHECK(expected_minor>0),spend_id TEXT NOT NULL UNIQUE REFERENCES spends(id),created_at TEXT NOT NULL,UNIQUE(subscription_id,due_date));
CREATE INDEX IF NOT EXISTS subscription_entity_owner ON subscriptions(entity_id,owner_id);
INSERT OR IGNORE INTO migrations VALUES(6, datetime('now'));

CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),spend_id TEXT NOT NULL REFERENCES spends(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),reference TEXT NOT NULL,reason TEXT NOT NULL,date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reconciled','posted','cancelled')),created_by TEXT NOT NULL REFERENCES users(id),reconciler_id TEXT REFERENCES users(id),bank_transaction_id TEXT UNIQUE REFERENCES bank_transactions(id),created_at TEXT NOT NULL,UNIQUE(entity_id,reference));
CREATE TRIGGER IF NOT EXISTS refund_final_update BEFORE UPDATE ON refunds WHEN OLD.status IN ('posted','cancelled') BEGIN SELECT RAISE(ABORT,'Final refunds are immutable'); END;
CREATE TRIGGER IF NOT EXISTS refund_delete BEFORE DELETE ON refunds BEGIN SELECT RAISE(ABORT,'Refund history is immutable'); END;

CREATE TABLE IF NOT EXISTS expense_adjustments(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),spend_id TEXT NOT NULL REFERENCES spends(id),kind TEXT NOT NULL CHECK(kind IN ('credit_note','personal_refund')),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),reference TEXT NOT NULL,reason TEXT NOT NULL,evidence_reference TEXT NOT NULL,date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','posted','cancelled')),created_by TEXT NOT NULL REFERENCES users(id),verified_by TEXT REFERENCES users(id),payable_reduction_minor INTEGER NOT NULL DEFAULT 0,recoverable_minor INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(entity_id,reference));
CREATE TRIGGER IF NOT EXISTS adjustment_final_update BEFORE UPDATE ON expense_adjustments WHEN OLD.status IN ('posted','cancelled') BEGIN SELECT RAISE(ABORT,'Final adjustments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS adjustment_delete BEFORE DELETE ON expense_adjustments BEGIN SELECT RAISE(ABORT,'Adjustment history is immutable'); END;

CREATE TABLE IF NOT EXISTS recovery_payments(id TEXT PRIMARY KEY,adjustment_id TEXT NOT NULL REFERENCES expense_adjustments(id),entity_id TEXT NOT NULL REFERENCES entities(id),person_id TEXT NOT NULL REFERENCES users(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),date TEXT NOT NULL,reference TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reconciled','posted','cancelled')),created_by TEXT NOT NULL REFERENCES users(id),reconciler_id TEXT REFERENCES users(id),bank_transaction_id TEXT UNIQUE REFERENCES bank_transactions(id),created_at TEXT NOT NULL,UNIQUE(entity_id,reference));
CREATE TRIGGER IF NOT EXISTS recovery_final_update BEFORE UPDATE ON recovery_payments WHEN OLD.status IN ('posted','cancelled') BEGIN SELECT RAISE(ABORT,'Final recoveries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS recovery_delete BEFORE DELETE ON recovery_payments BEGIN SELECT RAISE(ABORT,'Recovery history is immutable'); END;

-- Accountant-entered records document obligations and payments already made.
CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),name TEXT NOT NULL,employee_code TEXT NOT NULL,department TEXT NOT NULL,job_title TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('employee','founder')),salary_minor INTEGER NOT NULL CHECK(salary_minor>=0),start_date TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,UNIQUE(entity_id,employee_code));
CREATE TABLE IF NOT EXISTS bookkeeping_records(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),kind TEXT NOT NULL CHECK(kind IN ('expense','salary')),description TEXT NOT NULL,payee TEXT NOT NULL,employee_id TEXT REFERENCES employees(id),category TEXT NOT NULL,department TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),date TEXT NOT NULL,due_date TEXT NOT NULL,payroll_month TEXT,reference TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_month_unique ON bookkeeping_records(entity_id,employee_id,payroll_month) WHERE kind='salary';
CREATE UNIQUE INDEX IF NOT EXISTS bookkeeping_invoice_unique ON bookkeeping_records(entity_id,payee,reference) WHERE reference<>'' AND kind='expense';
CREATE TABLE IF NOT EXISTS bookkeeping_payments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES bookkeeping_records(id),entity_id TEXT NOT NULL REFERENCES entities(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),date TEXT NOT NULL,reference TEXT NOT NULL,method TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,UNIQUE(entity_id,reference));

CREATE TRIGGER IF NOT EXISTS bookkeeping_record_no_delete BEFORE DELETE ON bookkeeping_records BEGIN SELECT RAISE(ABORT,'Recorded expenses are immutable'); END;

CREATE TRIGGER IF NOT EXISTS bookkeeping_payment_no_delete BEFORE DELETE ON bookkeeping_payments BEGIN SELECT RAISE(ABORT,'Recorded payments are immutable'); END;
INSERT OR IGNORE INTO migrations VALUES(9, datetime('now'));
CREATE TABLE IF NOT EXISTS record_attachments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES bookkeeping_records(id),filename TEXT NOT NULL,mime TEXT NOT NULL,hash TEXT NOT NULL,encrypted BLOB NOT NULL,created_at TEXT NOT NULL,UNIQUE(record_id,hash));
CREATE TRIGGER IF NOT EXISTS record_attachment_no_update BEFORE UPDATE ON record_attachments BEGIN SELECT RAISE(ABORT,'Attachments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS record_attachment_no_delete BEFORE DELETE ON record_attachments BEGIN SELECT RAISE(ABORT,'Attachments are immutable'); END;

CREATE TABLE IF NOT EXISTS bookkeeping_corrections(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),kind TEXT NOT NULL,target_id TEXT NOT NULL,revision INTEGER NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(kind,target_id,revision));
CREATE TRIGGER IF NOT EXISTS correction_no_update BEFORE UPDATE ON bookkeeping_corrections BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS correction_no_delete BEFORE DELETE ON bookkeeping_corrections BEGIN SELECT RAISE(ABORT,'Correction history is immutable'); END;

CREATE TABLE IF NOT EXISTS subscription_records(
 subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
 due_date TEXT NOT NULL,
 record_id TEXT NOT NULL UNIQUE REFERENCES bookkeeping_records(id),
 expected_minor INTEGER NOT NULL CHECK(expected_minor>0),
 PRIMARY KEY(subscription_id,due_date)
);

CREATE TABLE IF NOT EXISTS subscription_categories(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),name TEXT NOT NULL COLLATE NOCASE,accounting_category TEXT NOT NULL,UNIQUE(entity_id,name));
CREATE TABLE IF NOT EXISTS subscription_details(subscription_id TEXT PRIMARY KEY REFERENCES subscriptions(id),start_date TEXT NOT NULL,employee_id TEXT REFERENCES employees(id),category_id TEXT REFERENCES subscription_categories(id),users_count INTEGER);

CREATE TABLE IF NOT EXISTS bookkeeping_refunds(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES bookkeeping_records(id),entity_id TEXT NOT NULL REFERENCES entities(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),date TEXT NOT NULL,reference TEXT NOT NULL,method TEXT NOT NULL,reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,voided INTEGER NOT NULL DEFAULT 0,UNIQUE(entity_id,reference));
CREATE TABLE IF NOT EXISTS bookkeeping_bank_matches(bank_transaction_id TEXT PRIMARY KEY REFERENCES bank_transactions(id),payment_id TEXT UNIQUE REFERENCES bookkeeping_payments(id),refund_id TEXT UNIQUE REFERENCES bookkeeping_refunds(id),matched_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,CHECK((payment_id IS NOT NULL)+(refund_id IS NOT NULL)=1));
CREATE TRIGGER IF NOT EXISTS bookkeeping_refund_no_delete BEFORE DELETE ON bookkeeping_refunds BEGIN SELECT RAISE(ABORT,'Refund history cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS bookkeeping_refund_no_rewrite BEFORE UPDATE ON bookkeeping_refunds WHEN NEW.id<>OLD.id OR NEW.record_id<>OLD.record_id OR NEW.entity_id<>OLD.entity_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.date<>OLD.date OR NEW.reference<>OLD.reference OR NEW.method<>OLD.method OR NEW.reason<>OLD.reason OR NEW.request_key<>OLD.request_key OR OLD.voided=1 OR NEW.voided<>1 BEGIN SELECT RAISE(ABORT,'Refunds can only be reversed, not rewritten'); END;

CREATE TABLE IF NOT EXISTS workspace_categories (
 entity_id TEXT NOT NULL REFERENCES entities(id), name TEXT NOT NULL COLLATE NOCASE,
 accounting_category TEXT NOT NULL, PRIMARY KEY(entity_id,name)
);
CREATE TABLE IF NOT EXISTS sales_invoices (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), number TEXT NOT NULL,
 request_key TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 document TEXT NOT NULL, total_minor INTEGER NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, UNIQUE(entity_id,number)
);
