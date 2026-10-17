/**
 * Database initialization, foreign key activation and transaction management for Cobrix.
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { COBRIX_SCHEMA } from './schema.ts'

export const DEFAULT_COBRIX_DB = resolve(process.cwd(), 'data/cobrix.sqlite')

/**
 * Creates and initializes a Cobrix SQLite database with schema and foreign keys enabled.
 * Accepts a file path or ':memory:' for isolated testing.
 */
export function createCobrixDatabase(dbPath: string = DEFAULT_COBRIX_DB): DatabaseSync {
	if (dbPath !== ':memory:') {
		mkdirSync(dirname(dbPath), { recursive: true })
	}

	const db = new DatabaseSync(dbPath, {
		enableForeignKeyConstraints: true,
	})

	// Defensive foreign keys and busy timeout
	db.exec('PRAGMA foreign_keys = ON;')
	db.exec('PRAGMA busy_timeout = 5000;')

	// Create tables and indexes
	db.exec(COBRIX_SCHEMA)

	// Ensure backwards compatibility by idempotently migrating missing columns
	migrateConfigSchemaIfNeeded(db)
	migrateSyncRunSchemaIfNeeded(db)

	// Ensure default singleton configuration exists
	db.exec(`
		INSERT OR IGNORE INTO config (
			id, company_name, company_tax_id, company_email,
			api_url, api_username, api_password, importable_statuses,
			grace_days, auto_run_hour, auto_run_active
		) VALUES (
			1, 'Cobrix Telecom', 'J-50000000-0', 'cobranzas@cobrix.test',
			'http://127.0.0.1:4310/api/v1', 'cobrix', 'cobrix-sandbox', 'ACTIVO,CORTADO',
			0, '04:00', 0
		);
	`)

	return db
}

/**
 * Migra de forma no destructiva e idempotente el esquema de la tabla config
 * para agregar las columnas de rastreo de corridas automáticas si no existen.
 */
export function migrateConfigSchemaIfNeeded(db: DatabaseSync): void {
	const columns = db.prepare('PRAGMA table_info(config);').all()
	let hasLastAutoRunDate = false
	let hasLastAutoRunStatus = false

	for (const col of columns) {
		const name = col['name']
		if (name === 'last_auto_run_date') {
			hasLastAutoRunDate = true
		} else if (name === 'last_auto_run_status') {
			hasLastAutoRunStatus = true
		}
	}

	if (!hasLastAutoRunDate) {
		db.exec('ALTER TABLE config ADD COLUMN last_auto_run_date TEXT;')
	}
	if (!hasLastAutoRunStatus) {
		db.exec('ALTER TABLE config ADD COLUMN last_auto_run_status TEXT;')
	}
}

/**
 * Migra de forma no destructiva e idempotente el esquema de la tabla sync_run
 * para agregar la columna trigger_type si no existe.
 */
export function migrateSyncRunSchemaIfNeeded(db: DatabaseSync): void {
	const columns = db.prepare('PRAGMA table_info(sync_run);').all()
	let hasTriggerType = false

	for (const col of columns) {
		const name = col['name']
		if (name === 'trigger_type') {
			hasTriggerType = true
			break
		}
	}

	if (!hasTriggerType) {
		db.exec("ALTER TABLE sync_run ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL', 'SCHEDULED'));")
	}
}

/**
 * Executes a callback within a SQLite transaction.
 * Rolls back changes and re-throws if an exception occurs.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
	db.exec('BEGIN')
	try {
		const result = fn()
		db.exec('COMMIT')
		return result
	} catch (error) {
		db.exec('ROLLBACK')
		throw error
	}
}
