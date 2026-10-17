/**
 * SQLite relational schema for Cobrix.
 * Enforces primary keys, foreign keys, unique constraints and data integrity.
 */

export const COBRIX_SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	company_name TEXT NOT NULL DEFAULT 'Cobrix Telecom',
	company_tax_id TEXT NOT NULL DEFAULT 'J-50000000-0',
	company_email TEXT NOT NULL DEFAULT 'cobranzas@cobrix.test',
	api_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:4310/api/v1',
	api_username TEXT NOT NULL DEFAULT 'cobrix',
	api_password TEXT NOT NULL DEFAULT 'cobrix-sandbox',
	importable_statuses TEXT NOT NULL DEFAULT 'ACTIVO,CORTADO',
	window_months INTEGER,
	max_recent_installments INTEGER,
	grace_days INTEGER NOT NULL DEFAULT 0,
	run_invoice_limit INTEGER,
	run_amount_limit_cents INTEGER,
	excluded_document_types TEXT NOT NULL DEFAULT '',
	auto_run_hour TEXT NOT NULL DEFAULT '04:00',
	auto_run_active INTEGER NOT NULL DEFAULT 0,
	last_auto_run_date TEXT,
	last_auto_run_status TEXT CHECK (last_auto_run_status IN ('RUNNING', 'COMPLETED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS customer (
	id TEXT PRIMARY KEY,
	original_document TEXT NOT NULL,
	document_type TEXT,
	person_type TEXT NOT NULL CHECK (person_type IN ('NATURAL', 'JURIDICA')),
	name TEXT NOT NULL,
	phone TEXT NOT NULL DEFAULT '',
	email TEXT NOT NULL DEFAULT '',
	address TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract (
	id INTEGER PRIMARY KEY,
	customer_id TEXT NOT NULL REFERENCES customer(id) ON UPDATE CASCADE ON DELETE RESTRICT,
	code TEXT NOT NULL,
	status TEXT NOT NULL,
	plan TEXT NOT NULL,
	plan_price_cents INTEGER NOT NULL,
	branch TEXT NOT NULL,
	currency TEXT NOT NULL,
	billing_day INTEGER NOT NULL,
	cutoff_day INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	invoice_number TEXT NOT NULL UNIQUE,
	external_debt_id TEXT NOT NULL UNIQUE,
	contract_id INTEGER NOT NULL REFERENCES contract(id) ON UPDATE CASCADE ON DELETE RESTRICT,
	customer_id TEXT NOT NULL REFERENCES customer(id) ON UPDATE CASCADE ON DELETE RESTRICT,
	period TEXT NOT NULL,
	due_date TEXT NOT NULL,
	cut_date TEXT NOT NULL,
	total_amount_cents INTEGER NOT NULL,
	balance_cents INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('OPEN', 'PAID')),
	paid_at TEXT,
	isp_payment_invoice TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_run (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL CHECK (type IN ('IMPORT', 'PAYMENT_UPDATE')),
	trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL', 'SCHEDULED')),
	is_simulation INTEGER NOT NULL CHECK (is_simulation IN (0, 1)),
	status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
	started_at TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	error_message TEXT,
	summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_run_detail (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL REFERENCES sync_run(id) ON DELETE CASCADE,
	contract_id INTEGER NOT NULL,
	debt_id TEXT NOT NULL,
	period TEXT NOT NULL,
	amount_cents INTEGER NOT NULL,
	result TEXT NOT NULL,
	reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_event (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
	event_type TEXT NOT NULL CHECK (event_type IN ('CUSTOMER_CREATED', 'INVOICE_IMPORTED', 'INVOICE_PAID', 'PARTIAL_PAYMENT')),
	description TEXT NOT NULL,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_customer ON contract(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_customer ON invoice(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_contract ON invoice(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoice_status ON invoice(status);
CREATE INDEX IF NOT EXISTS idx_sync_run_detail_run ON sync_run_detail(run_id);
CREATE INDEX IF NOT EXISTS idx_customer_event_customer ON customer_event(customer_id);
`
