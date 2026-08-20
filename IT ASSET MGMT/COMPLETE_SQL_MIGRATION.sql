-- ============================================================
-- CHAMARIA GROUP IT PORTAL — COMPLETE DATABASE MIGRATION
-- Run this ONCE in Supabase SQL Editor
-- Date: 2026-08-14
-- ============================================================

-- ① IT SERVICES — all new columns
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS po_file_name TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS po_storage_path TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS invoice_file_name TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS invoice_storage_path TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS has_invoice BOOLEAN DEFAULT false;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS has_po BOOLEAN DEFAULT false;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_site_name TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_primary_url TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_secondary_url TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_access_type TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_status TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_username TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS fw_password TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS vpn_software TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS vpn_ip TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS vpn_port TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS vpn_username TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS vpn_password TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS vpn_notes TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS wifi_ip TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS wifi_username TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS wifi_password TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS switch_ip TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS switch_username TEXT;
ALTER TABLE it_services ADD COLUMN IF NOT EXISTS switch_password TEXT;

-- ② IT PROJECTS table
CREATE TABLE IF NOT EXISTS it_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  start_date DATE,
  completion_date DATE,
  order_status TEXT,
  delivery_status TEXT,
  install_status TEXT,
  status TEXT DEFAULT 'active',
  items_json TEXT DEFAULT '[]',
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE it_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select" ON it_projects;
DROP POLICY IF EXISTS "insert" ON it_projects;
DROP POLICY IF EXISTS "update" ON it_projects;
DROP POLICY IF EXISTS "delete" ON it_projects;
DROP POLICY IF EXISTS "block_anon" ON it_projects;
CREATE POLICY "select" ON it_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert" ON it_projects FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update" ON it_projects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete" ON it_projects FOR DELETE TO authenticated USING (true);
CREATE POLICY "block_anon" ON it_projects AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

-- ③ TICKETS table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asset_type TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Medium';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Open';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS submitted_by_email TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT 'IT Admin';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS image_filename TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS device_brand TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS device_model TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS specifications TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select" ON tickets;
DROP POLICY IF EXISTS "insert" ON tickets;
DROP POLICY IF EXISTS "update" ON tickets;
DROP POLICY IF EXISTS "delete" ON tickets;
DROP POLICY IF EXISTS "block_anon" ON tickets;
CREATE POLICY "select" ON tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert" ON tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update" ON tickets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete" ON tickets FOR DELETE TO authenticated USING (true);
CREATE POLICY "block_anon" ON tickets AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

-- ④ ASSET DISCOVERY table
CREATE TABLE IF NOT EXISTS asset_discovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  computer_name TEXT,
  username TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  bios_version TEXT,
  system_type TEXT,
  processor TEXT,
  processor_cores TEXT,
  processor_speed TEXT,
  ram_gb TEXT,
  storage TEXT,
  free_space TEXT,
  graphics TEXT,
  monitor TEXT,
  battery TEXT,
  os_name TEXT,
  os_version TEXT,
  os_build TEXT,
  os_arch TEXT,
  ip_address TEXT,
  mac_address TEXT,
  gateway TEXT,
  installed_software JSONB DEFAULT '[]',
  installed_software_raw TEXT,
  last_boot TEXT,
  agent_version TEXT,
  scan_timestamp TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending'
);
ALTER TABLE asset_discovery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert" ON asset_discovery;
DROP POLICY IF EXISTS "auth_all" ON asset_discovery;
CREATE POLICY "anon_insert" ON asset_discovery FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_all" ON asset_discovery FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ⑤ PROTECTION TRIGGERS
CREATE OR REPLACE FUNCTION protect_it_services_attachments()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.has_invoice = true AND NEW.has_invoice = false
     AND (NEW.invoice_file_name IS NULL OR NEW.invoice_file_name = '') THEN
    NEW.has_invoice := OLD.has_invoice;
    NEW.invoice_file_name := OLD.invoice_file_name;
    NEW.invoice_storage_path := OLD.invoice_storage_path;
  END IF;
  IF OLD.has_po = true AND NEW.has_po = false
     AND (NEW.po_file_name IS NULL OR NEW.po_file_name = '') THEN
    NEW.has_po := OLD.has_po;
    NEW.po_file_name := OLD.po_file_name;
    NEW.po_storage_path := OLD.po_storage_path;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS protect_it_services_attachments ON it_services;
CREATE TRIGGER protect_it_services_attachments
  BEFORE UPDATE ON it_services
  FOR EACH ROW EXECUTE FUNCTION protect_it_services_attachments();

CREATE OR REPLACE FUNCTION protect_asset_invoice()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.has_invoice = true AND NEW.has_invoice = false
     AND (NEW.invoice_file_name IS NULL OR NEW.invoice_file_name = '') THEN
    NEW.has_invoice := OLD.has_invoice;
    NEW.invoice_file_name := OLD.invoice_file_name;
    NEW.invoice_storage_path := OLD.invoice_storage_path;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS protect_asset_invoice ON assets;
CREATE TRIGGER protect_asset_invoice
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION protect_asset_invoice();

CREATE OR REPLACE FUNCTION protect_company_cert()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cst_certificate_filename IS NOT NULL
     AND (NEW.cst_certificate_filename IS NULL OR NEW.cst_certificate_filename = '') THEN
    NEW.cst_certificate_filename := OLD.cst_certificate_filename;
    NEW.cst_certificate_path := OLD.cst_certificate_path;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS protect_company_cert ON companies;
CREATE TRIGGER protect_company_cert
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION protect_company_cert();

-- ⑥ STORAGE BUCKETS & POLICIES
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-attachments', 'ticket-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "auth_upload_tickets" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_tickets" ON storage.objects;
CREATE POLICY "auth_upload_tickets" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ticket-attachments');
CREATE POLICY "auth_read_tickets" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ticket-attachments');

-- ============================================================
-- DONE! All tables, policies, triggers, and buckets created.
-- ============================================================
