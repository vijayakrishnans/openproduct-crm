-- 200_crm_core
-- CRM persistence foundation — the org-scoped port of Atomic CRM's schema
-- (supabase/schemas/*.sql at aeccb98, MIT, © 2024-present Francois Zaninotto,
-- Marmelab; see THIRD_PARTY_NOTICES.md).
-- Bounded context: crm
--
-- Tenancy contract (specs/epics/openproduct-crm-port/design.md §1.3):
--   * every table carries org_id UUID NOT NULL, an opaque reference to the
--     Lumen organization (no cross-context foreign key);
--   * every foreign key inside the schema is composite on (org_id, id), so a
--     row can never point at another org's row;
--   * row-level security compares org_id with the transaction-local setting
--     app.org_id. crm-worker runs every request as
--       BEGIN; SET LOCAL ROLE crm_app;
--       SELECT set_config('app.org_id', <org>, true),
--              set_config('app.subject_id', <actor>, true); ...; COMMIT;
--     and still filters by org_id in every statement. Both layers are
--     mandatory. With app.org_id unset, crm_app sees no rows and can write none.
--
-- What moved out of SQL: avatars and favicons (http), attachment cleanup
-- (pg_net) and everything on auth.users belong to crm-worker and the Lumen
-- identity/membership workers. configuration lives in config-worker and
-- user_invitations in membership-worker.
--
-- The runner applies this file in autocommit against Supabase, so every
-- statement is idempotent.

CREATE SCHEMA IF NOT EXISTS crm;

COMMENT ON SCHEMA crm IS 'CRM bounded context — companies, contacts, deals, notes, tasks, tags and sales profiles. Every row is scoped by org_id.';

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
-- btree_gin lets the search indexes lead with org_id.
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- The role crm-worker switches to. It has no BYPASSRLS, so the policies below
-- always apply to it. The connecting role must be a member to SET ROLE.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app NOLOGIN;
  END IF;

  EXECUTE format('GRANT crm_app TO %I', current_user);

  IF current_user <> 'postgres'
     AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT crm_app TO postgres;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Request context
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

COMMENT ON FUNCTION crm.current_org_id() IS 'The org of the current request (transaction-local app.org_id), or NULL when unset.';

CREATE OR REPLACE FUNCTION crm.current_subject_id() RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$ select nullif(current_setting('app.subject_id', true), '') $$;

COMMENT ON FUNCTION crm.current_subject_id() IS 'The Lumen actor of the current request (transaction-local app.subject_id), or NULL when unset.';

-- ---------------------------------------------------------------------------
-- Search helpers (port of 08_search.sql)
-- Documents and queries are normalized the same way: unaccented, lowercased,
-- split on anything that is not a letter or a digit. So "hélène.dupont@acme.fr"
-- indexes as helene, dupont, acme, fr and any of those prefixes finds it.
-- ---------------------------------------------------------------------------

-- unaccent() is only STABLE (its dictionary could change), which generated
-- columns reject. The dictionary is fixed here, so the wrapper is immutable.
CREATE OR REPLACE FUNCTION crm.search_unaccent(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO ''
    AS $$ select extensions.unaccent('extensions.unaccent'::regdictionary, value) $$;

CREATE OR REPLACE FUNCTION crm.search_document(VARIADIC parts text[]) RETURNS tsvector
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
        select to_tsvector(
            'simple'::regconfig,
            regexp_replace(crm.search_unaccent(array_to_string(parts, ' ')), '[^[:alnum:]]+', ' ', 'g')
        )
    $$;

-- Every word of the query must match, each one as a prefix: "tho dup" finds
-- "Thomas Dupont". Returns null (matching nothing) for a blank query.
CREATE OR REPLACE FUNCTION crm.search_query(query text) RETURNS tsquery
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO ''
    AS $$
        select to_tsquery('simple'::regconfig, string_agg(word || ':*', ' & '))
        from regexp_split_to_table(lower(crm.search_unaccent(query)), '[^[:alnum:]]+') as word
        where word <> ''
    $$;

CREATE OR REPLACE FUNCTION crm.search_attachment_titles(attachments jsonb[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$ select string_agg(attachment ->> 'title', ' ') from unnest(attachments) as attachment $$;

-- ---------------------------------------------------------------------------
-- Tables (port of 01_tables.sql)
-- ---------------------------------------------------------------------------

-- A sales profile: display data for one Lumen org member. Identity, sessions
-- and roles stay with identity-worker and membership-worker.
CREATE TABLE IF NOT EXISTS crm.sales (
    id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id           uuid NOT NULL DEFAULT crm.current_org_id(),
    subject_id       text NOT NULL,
    first_name       text NOT NULL DEFAULT 'Pending',
    last_name        text NOT NULL DEFAULT 'Pending',
    email            text NOT NULL,
    administrator    boolean NOT NULL DEFAULT false,
    avatar           jsonb,
    disabled         boolean NOT NULL DEFAULT false,
    secondary_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT sales_org_id_id_key UNIQUE (org_id, id),
    CONSTRAINT sales_org_subject_key UNIQUE (org_id, subject_id),
    CONSTRAINT sales_secondary_emails_is_array CHECK (jsonb_typeof(secondary_emails) = 'array')
);

COMMENT ON TABLE crm.sales IS 'CRM profile of an org member. Every query must scope by org_id.';
COMMENT ON COLUMN crm.sales.org_id IS 'Owning organization — opaque reference, no cross-context FK.';
COMMENT ON COLUMN crm.sales.subject_id IS 'Subject id of the Lumen org member (as the membership worker stores it) — opaque reference, no cross-context FK.';
COMMENT ON COLUMN crm.sales.administrator IS 'Display mirror of the member''s admin role; authorization is decided by policy-worker.';

CREATE UNIQUE INDEX IF NOT EXISTS sales_org_email_lower_idx
    ON crm.sales (org_id, lower(email));

CREATE TABLE IF NOT EXISTS crm.tags (
    id     bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id uuid NOT NULL DEFAULT crm.current_org_id(),
    name   text NOT NULL,
    color  text NOT NULL,
    CONSTRAINT tags_org_id_id_key UNIQUE (org_id, id)
);

COMMENT ON TABLE crm.tags IS 'Contact tags. Every query must scope by org_id.';

CREATE TABLE IF NOT EXISTS crm.companies (
    id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id         uuid NOT NULL DEFAULT crm.current_org_id(),
    created_at     timestamptz NOT NULL DEFAULT now(),
    name           text NOT NULL,
    sector         text,
    size           smallint,
    linkedin_url   text,
    website        text,
    phone_number   text,
    address        text,
    zipcode        text,
    city           text,
    state_abbr     text,
    sales_id       bigint,
    context_links  json,
    country        text,
    description    text,
    revenue        text,
    tax_identifier text,
    logo           jsonb,
    fts            tsvector GENERATED ALWAYS AS (
        setweight(crm.search_document(name), 'A')
        || crm.search_document(sector, description, website, phone_number, zipcode, city, state_abbr)
    ) STORED,
    CONSTRAINT companies_org_id_id_key UNIQUE (org_id, id),
    CONSTRAINT companies_sales_id_fkey FOREIGN KEY (org_id, sales_id) REFERENCES crm.sales (org_id, id)
);

COMMENT ON TABLE crm.companies IS 'Companies. Every query must scope by org_id.';

CREATE TABLE IF NOT EXISTS crm.contacts (
    id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id         uuid NOT NULL DEFAULT crm.current_org_id(),
    first_name     text,
    last_name      text,
    gender         text,
    title          text,
    background     text,
    avatar         jsonb,
    first_seen     timestamptz,
    last_seen      timestamptz,
    has_newsletter boolean,
    status         text,
    tags           bigint[],
    company_id     bigint,
    sales_id       bigint,
    linkedin_url   text,
    email_jsonb    jsonb,
    phone_jsonb    jsonb,
    fts            tsvector GENERATED ALWAYS AS (
        setweight(crm.search_document(first_name, last_name), 'A')
        || crm.search_document(
            title,
            background,
            jsonb_path_query_array(email_jsonb, '$[*]."email"')::text,
            jsonb_path_query_array(phone_jsonb, '$[*]."number"')::text
        )
    ) STORED,
    CONSTRAINT contacts_org_id_id_key UNIQUE (org_id, id),
    CONSTRAINT contacts_company_id_fkey FOREIGN KEY (org_id, company_id) REFERENCES crm.companies (org_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT contacts_sales_id_fkey FOREIGN KEY (org_id, sales_id) REFERENCES crm.sales (org_id, id)
);

COMMENT ON TABLE crm.contacts IS 'Contacts. Every query must scope by org_id.';
COMMENT ON COLUMN crm.contacts.tags IS 'Ids of crm.tags rows of the same org (checked by trigger).';

CREATE TABLE IF NOT EXISTS crm.contact_notes (
    id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id      uuid NOT NULL DEFAULT crm.current_org_id(),
    contact_id  bigint NOT NULL,
    text        text,
    date        timestamptz DEFAULT now(),
    sales_id    bigint,
    status      text,
    attachments jsonb[],
    fts         tsvector GENERATED ALWAYS AS (
        crm.search_document(text, crm.search_attachment_titles(attachments))
    ) STORED,
    CONSTRAINT contact_notes_org_id_id_key UNIQUE (org_id, id),
    CONSTRAINT contact_notes_contact_id_fkey FOREIGN KEY (org_id, contact_id) REFERENCES crm.contacts (org_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT contact_notes_sales_id_fkey FOREIGN KEY (org_id, sales_id) REFERENCES crm.sales (org_id, id) ON UPDATE CASCADE ON DELETE CASCADE
);

COMMENT ON TABLE crm.contact_notes IS 'Notes on contacts. Every query must scope by org_id.';

CREATE TABLE IF NOT EXISTS crm.deals (
    id                    bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id                uuid NOT NULL DEFAULT crm.current_org_id(),
    name                  text NOT NULL,
    company_id            bigint,
    contact_ids           bigint[],
    categories            text[],
    stage                 text NOT NULL,
    description           text,
    amount                bigint,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    archived_at           timestamptz,
    expected_closing_date date,
    sales_id              bigint,
    index                 smallint,
    fts                   tsvector GENERATED ALWAYS AS (
        setweight(crm.search_document(name), 'A')
        || crm.search_document(VARIADIC ARRAY[description] || categories)
    ) STORED,
    CONSTRAINT deals_org_id_id_key UNIQUE (org_id, id),
    -- Rejects implausible dates, e.g. typos such as 5-digit years, plus BC dates and infinity, which the UI cannot display
    CONSTRAINT deals_expected_closing_date_range CHECK (expected_closing_date BETWEEN '1900-01-01' AND '2900-12-31'),
    CONSTRAINT deals_company_id_fkey FOREIGN KEY (org_id, company_id) REFERENCES crm.companies (org_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT deals_sales_id_fkey FOREIGN KEY (org_id, sales_id) REFERENCES crm.sales (org_id, id)
);

COMMENT ON TABLE crm.deals IS 'Deals. Every query must scope by org_id.';
COMMENT ON COLUMN crm.deals.contact_ids IS 'Ids of crm.contacts rows of the same org (checked by trigger).';

CREATE TABLE IF NOT EXISTS crm.deal_notes (
    id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id      uuid NOT NULL DEFAULT crm.current_org_id(),
    deal_id     bigint NOT NULL,
    type        text,
    text        text,
    date        timestamptz DEFAULT now(),
    sales_id    bigint,
    attachments jsonb[],
    fts         tsvector GENERATED ALWAYS AS (
        crm.search_document(text, crm.search_attachment_titles(attachments))
    ) STORED,
    CONSTRAINT deal_notes_org_id_id_key UNIQUE (org_id, id),
    CONSTRAINT deal_notes_deal_id_fkey FOREIGN KEY (org_id, deal_id) REFERENCES crm.deals (org_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT deal_notes_sales_id_fkey FOREIGN KEY (org_id, sales_id) REFERENCES crm.sales (org_id, id)
);

COMMENT ON TABLE crm.deal_notes IS 'Notes on deals. Every query must scope by org_id.';

CREATE TABLE IF NOT EXISTS crm.tasks (
    id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id     uuid NOT NULL DEFAULT crm.current_org_id(),
    contact_id bigint NOT NULL,
    type       text,
    text       text,
    due_date   timestamptz,
    done_date  timestamptz,
    sales_id   bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    fts        tsvector GENERATED ALWAYS AS (
        crm.search_document(text, type)
    ) STORED,
    CONSTRAINT tasks_org_id_id_key UNIQUE (org_id, id),
    CONSTRAINT tasks_contact_id_fkey FOREIGN KEY (org_id, contact_id) REFERENCES crm.contacts (org_id, id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT tasks_sales_id_fkey FOREIGN KEY (org_id, sales_id) REFERENCES crm.sales (org_id, id)
);

COMMENT ON TABLE crm.tasks IS 'Tasks on contacts. Every query must scope by org_id.';

CREATE TABLE IF NOT EXISTS crm.favicons_excluded_domains (
    id     bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    org_id uuid NOT NULL DEFAULT crm.current_org_id(),
    domain text NOT NULL,
    CONSTRAINT favicons_excluded_domains_org_id_id_key UNIQUE (org_id, id)
);

COMMENT ON TABLE crm.favicons_excluded_domains IS 'Email domains whose favicon must not be used as an avatar (webmail providers). Every query must scope by org_id.';

CREATE UNIQUE INDEX IF NOT EXISTS favicons_excluded_domains_org_domain_lower_idx
    ON crm.favicons_excluded_domains (org_id, lower(domain));

-- ---------------------------------------------------------------------------
-- Indexes. Every one leads with org_id.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS tags_org_name_idx ON crm.tags (org_id, name);
CREATE INDEX IF NOT EXISTS companies_org_name_idx ON crm.companies (org_id, name);
CREATE INDEX IF NOT EXISTS companies_org_created_at_idx ON crm.companies (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_org_company_id_idx ON crm.contacts (org_id, company_id);
CREATE INDEX IF NOT EXISTS contacts_org_last_seen_idx ON crm.contacts (org_id, last_seen DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS contact_notes_org_contact_id_idx ON crm.contact_notes (org_id, contact_id);
CREATE INDEX IF NOT EXISTS deals_org_company_id_idx ON crm.deals (org_id, company_id);
CREATE INDEX IF NOT EXISTS deals_org_stage_index_idx ON crm.deals (org_id, stage, index);
CREATE INDEX IF NOT EXISTS deal_notes_org_deal_id_idx ON crm.deal_notes (org_id, deal_id);
CREATE INDEX IF NOT EXISTS tasks_org_contact_id_idx ON crm.tasks (org_id, contact_id);
CREATE INDEX IF NOT EXISTS tasks_org_due_date_idx ON crm.tasks (org_id, due_date) WHERE done_date IS NULL;

-- Array membership lookups (a tag's contacts, a contact's deals).
CREATE INDEX IF NOT EXISTS contacts_org_tags_idx ON crm.contacts USING gin (org_id, tags);
CREATE INDEX IF NOT EXISTS deals_org_contact_ids_idx ON crm.deals USING gin (org_id, contact_ids);

-- Search. Partial indexes mirror what global_search() returns: open tasks,
-- live deals.
CREATE INDEX IF NOT EXISTS companies_org_fts_idx ON crm.companies USING gin (org_id, fts);
CREATE INDEX IF NOT EXISTS contacts_org_fts_idx ON crm.contacts USING gin (org_id, fts);
CREATE INDEX IF NOT EXISTS deals_org_fts_idx ON crm.deals USING gin (org_id, fts) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_org_fts_idx ON crm.tasks USING gin (org_id, fts) WHERE done_date IS NULL;
CREATE INDEX IF NOT EXISTS contact_notes_org_fts_idx ON crm.contact_notes USING gin (org_id, fts);
CREATE INDEX IF NOT EXISTS deal_notes_org_fts_idx ON crm.deal_notes USING gin (org_id, fts);

-- A word found in most rows (a common word, a 2-letter prefix) makes the GIN
-- path fetch and sort every match. Walking a date index backwards instead stops
-- at the first max_results matches. The planner picks between the two per
-- query, which needs fine-grained lexeme statistics on the large tables. This
-- only applies to tasks and notes: global_search() ranks the other resources
-- by relevance, which needs every match.
CREATE INDEX IF NOT EXISTS contacts_org_first_seen_idx ON crm.contacts (org_id, first_seen DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS tasks_org_open_created_at_idx ON crm.tasks (org_id, created_at DESC) WHERE done_date IS NULL;
CREATE INDEX IF NOT EXISTS contact_notes_org_date_idx ON crm.contact_notes (org_id, date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS deal_notes_org_date_idx ON crm.deal_notes (org_id, date DESC NULLS LAST);

ALTER TABLE crm.contacts ALTER COLUMN fts SET STATISTICS 10000;
ALTER TABLE crm.tasks ALTER COLUMN fts SET STATISTICS 10000;
ALTER TABLE crm.contact_notes ALTER COLUMN fts SET STATISTICS 10000;
ALTER TABLE crm.deal_notes ALTER COLUMN fts SET STATISTICS 10000;

-- ---------------------------------------------------------------------------
-- Trigger functions (port of 02_functions.sql). All run as the caller, so the
-- row-level policies apply inside them too.
-- ---------------------------------------------------------------------------

-- Default sales_id to the profile of the member making the request.
CREATE OR REPLACE FUNCTION crm.set_sales_id_default() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.sales_id IS NULL THEN
    SELECT s.id INTO NEW.sales_id
    FROM crm.sales s
    WHERE s.org_id = NEW.org_id AND s.subject_id = crm.current_subject_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.lowercase_email_jsonb() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.email_jsonb IS NOT NULL THEN
    NEW.email_jsonb = COALESCE((
      SELECT jsonb_agg(
        jsonb_set(elem, '{email}', to_jsonb(lower(elem->>'email')))
      )
      FROM jsonb_array_elements(NEW.email_jsonb) AS elem
    ), '[]'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.handle_contact_note_created() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE crm.contacts c
  SET last_seen = NEW.date
  WHERE c.org_id = NEW.org_id AND c.id = NEW.contact_id AND c.last_seen < NEW.date;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.handle_tag_deleted() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE crm.contacts c
  SET tags = array_remove(c.tags, OLD.id)
  WHERE c.org_id = OLD.org_id AND c.tags @> ARRAY[OLD.id];
  RETURN OLD;
END;
$$;

-- Arrays cannot carry foreign keys, so these two keep contacts.tags and
-- deals.contact_ids inside the row's own org.
CREATE OR REPLACE FUNCTION crm.check_contact_tags_org() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.tags IS NOT NULL AND EXISTS (
    SELECT FROM unnest(NEW.tags) AS ref(id)
    WHERE NOT EXISTS (
      SELECT FROM crm.tags t WHERE t.org_id = NEW.org_id AND t.id = ref.id
    )
  ) THEN
    RAISE EXCEPTION 'contacts.tags references a tag that does not exist in this organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.check_deal_contact_ids_org() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.contact_ids IS NOT NULL AND EXISTS (
    SELECT FROM unnest(NEW.contact_ids) AS ref(id)
    WHERE NOT EXISTS (
      SELECT FROM crm.contacts c WHERE c.org_id = NEW.org_id AND c.id = ref.id
    )
  ) THEN
    RAISE EXCEPTION 'deals.contact_ids references a contact that does not exist in this organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- A deleted contact leaves every deal it was attached to.
CREATE OR REPLACE FUNCTION crm.handle_contact_deleted() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE crm.deals d
  SET contact_ids = array_remove(d.contact_ids, OLD.id)
  WHERE d.org_id = OLD.org_id AND d.contact_ids @> ARRAY[OLD.id];
  RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers (port of 04_triggers.sql)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_company_sales_id_trigger
    BEFORE INSERT ON crm.companies
    FOR EACH ROW EXECUTE FUNCTION crm.set_sales_id_default();

CREATE OR REPLACE TRIGGER set_contact_sales_id_trigger
    BEFORE INSERT ON crm.contacts
    FOR EACH ROW EXECUTE FUNCTION crm.set_sales_id_default();

CREATE OR REPLACE TRIGGER set_contact_notes_sales_id_trigger
    BEFORE INSERT ON crm.contact_notes
    FOR EACH ROW EXECUTE FUNCTION crm.set_sales_id_default();

CREATE OR REPLACE TRIGGER set_deal_sales_id_trigger
    BEFORE INSERT ON crm.deals
    FOR EACH ROW EXECUTE FUNCTION crm.set_sales_id_default();

CREATE OR REPLACE TRIGGER set_deal_notes_sales_id_trigger
    BEFORE INSERT ON crm.deal_notes
    FOR EACH ROW EXECUTE FUNCTION crm.set_sales_id_default();

CREATE OR REPLACE TRIGGER set_task_sales_id_trigger
    BEFORE INSERT ON crm.tasks
    FOR EACH ROW EXECUTE FUNCTION crm.set_sales_id_default();

-- Lowercase contact emails before insert or update.
CREATE OR REPLACE TRIGGER "10_lowercase_contact_emails"
    BEFORE INSERT OR UPDATE ON crm.contacts
    FOR EACH ROW EXECUTE FUNCTION crm.lowercase_email_jsonb();

CREATE OR REPLACE TRIGGER "30_check_contact_tags_org"
    BEFORE INSERT OR UPDATE OF tags, org_id ON crm.contacts
    FOR EACH ROW EXECUTE FUNCTION crm.check_contact_tags_org();

CREATE OR REPLACE TRIGGER check_deal_contact_ids_org
    BEFORE INSERT OR UPDATE OF contact_ids, org_id ON crm.deals
    FOR EACH ROW EXECUTE FUNCTION crm.check_deal_contact_ids_org();

-- Update contact.last_seen when a contact note is created.
CREATE OR REPLACE TRIGGER on_contact_notes_created
    AFTER INSERT ON crm.contact_notes
    FOR EACH ROW EXECUTE FUNCTION crm.handle_contact_note_created();

-- Remove a deleted tag from every contact that references it.
CREATE OR REPLACE TRIGGER on_tag_deleted
    AFTER DELETE ON crm.tags
    FOR EACH ROW EXECUTE FUNCTION crm.handle_tag_deleted();

CREATE OR REPLACE TRIGGER on_contact_deleted
    AFTER DELETE ON crm.contacts
    FOR EACH ROW EXECUTE FUNCTION crm.handle_contact_deleted();

-- ---------------------------------------------------------------------------
-- Merge contacts (port of merge_contacts). The org is an explicit argument and
-- every statement filters on it; row-level security applies on top.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.merge_contacts(p_org_id uuid, loser_id bigint, winner_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  winner_contact crm.contacts%ROWTYPE;
  loser_contact crm.contacts%ROWTYPE;
  winner_found boolean;
  loser_found boolean;
  deal_record RECORD;
  merged_emails jsonb;
  merged_phones jsonb;
  merged_tags bigint[];
  winner_emails jsonb;
  loser_emails jsonb;
  winner_phones jsonb;
  loser_phones jsonb;
  email_map jsonb;
  phone_map jsonb;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org id is required';
  END IF;

  IF loser_id = winner_id THEN
    RAISE EXCEPTION 'Cannot merge a contact with itself';
  END IF;

  -- Fetch and lock both contacts
  SELECT * INTO winner_contact FROM crm.contacts c
    WHERE c.org_id = p_org_id AND c.id = winner_id FOR UPDATE;
  winner_found := FOUND;
  SELECT * INTO loser_contact FROM crm.contacts c
    WHERE c.org_id = p_org_id AND c.id = loser_id FOR UPDATE;
  loser_found := FOUND;

  IF NOT winner_found OR NOT loser_found THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. Reassign tasks from loser to winner
  UPDATE crm.tasks t SET contact_id = winner_id
    WHERE t.org_id = p_org_id AND t.contact_id = loser_id;

  -- 2. Reassign contact notes from loser to winner
  UPDATE crm.contact_notes n SET contact_id = winner_id
    WHERE n.org_id = p_org_id AND n.contact_id = loser_id;

  -- 3. Update deals - replace loser with winner in contact_ids array
  FOR deal_record IN
    SELECT d.id, d.contact_ids
    FROM crm.deals d
    WHERE d.org_id = p_org_id AND d.contact_ids @> ARRAY[loser_id]
  LOOP
    UPDATE crm.deals d
    SET contact_ids = (
      SELECT ARRAY(
        SELECT DISTINCT unnest(
          array_remove(deal_record.contact_ids, loser_id) || ARRAY[winner_id]
        )
      )
    )
    WHERE d.org_id = p_org_id AND d.id = deal_record.id;
  END LOOP;

  -- 4. Merge contact data

  winner_emails := COALESCE(winner_contact.email_jsonb, '[]'::jsonb);
  loser_emails := COALESCE(loser_contact.email_jsonb, '[]'::jsonb);

  -- Merge emails with deduplication by email address
  -- Build a map of email -> email object, then convert back to array
  email_map := '{}'::jsonb;

  IF jsonb_array_length(winner_emails) > 0 THEN
    FOR i IN 0..jsonb_array_length(winner_emails)-1 LOOP
      email_map := email_map || jsonb_build_object(
        winner_emails->i->>'email',
        winner_emails->i
      );
    END LOOP;
  END IF;

  -- Loser emails never overwrite existing keys
  IF jsonb_array_length(loser_emails) > 0 THEN
    FOR i IN 0..jsonb_array_length(loser_emails)-1 LOOP
      IF NOT email_map ? (loser_emails->i->>'email') THEN
        email_map := email_map || jsonb_build_object(
          loser_emails->i->>'email',
          loser_emails->i
        );
      END IF;
    END LOOP;
  END IF;

  merged_emails := (SELECT jsonb_agg(value) FROM jsonb_each(email_map));
  merged_emails := COALESCE(merged_emails, '[]'::jsonb);

  winner_phones := COALESCE(winner_contact.phone_jsonb, '[]'::jsonb);
  loser_phones := COALESCE(loser_contact.phone_jsonb, '[]'::jsonb);

  -- Merge phones with deduplication by number
  phone_map := '{}'::jsonb;

  IF jsonb_array_length(winner_phones) > 0 THEN
    FOR i IN 0..jsonb_array_length(winner_phones)-1 LOOP
      phone_map := phone_map || jsonb_build_object(
        winner_phones->i->>'number',
        winner_phones->i
      );
    END LOOP;
  END IF;

  IF jsonb_array_length(loser_phones) > 0 THEN
    FOR i IN 0..jsonb_array_length(loser_phones)-1 LOOP
      IF NOT phone_map ? (loser_phones->i->>'number') THEN
        phone_map := phone_map || jsonb_build_object(
          loser_phones->i->>'number',
          loser_phones->i
        );
      END IF;
    END LOOP;
  END IF;

  merged_phones := (SELECT jsonb_agg(value) FROM jsonb_each(phone_map));
  merged_phones := COALESCE(merged_phones, '[]'::jsonb);

  -- Merge tags (remove duplicates)
  merged_tags := ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(winner_contact.tags, ARRAY[]::bigint[]) ||
      COALESCE(loser_contact.tags, ARRAY[]::bigint[])
    )
  );

  -- 5. Update winner with merged data
  UPDATE crm.contacts c SET
    avatar = COALESCE(winner_contact.avatar, loser_contact.avatar),
    gender = COALESCE(winner_contact.gender, loser_contact.gender),
    first_name = COALESCE(winner_contact.first_name, loser_contact.first_name),
    last_name = COALESCE(winner_contact.last_name, loser_contact.last_name),
    title = COALESCE(winner_contact.title, loser_contact.title),
    company_id = COALESCE(winner_contact.company_id, loser_contact.company_id),
    email_jsonb = merged_emails,
    phone_jsonb = merged_phones,
    linkedin_url = COALESCE(winner_contact.linkedin_url, loser_contact.linkedin_url),
    background = COALESCE(winner_contact.background, loser_contact.background),
    has_newsletter = COALESCE(winner_contact.has_newsletter, loser_contact.has_newsletter),
    first_seen = LEAST(COALESCE(winner_contact.first_seen, loser_contact.first_seen), COALESCE(loser_contact.first_seen, winner_contact.first_seen)),
    last_seen = GREATEST(COALESCE(winner_contact.last_seen, loser_contact.last_seen), COALESCE(loser_contact.last_seen, winner_contact.last_seen)),
    sales_id = COALESCE(winner_contact.sales_id, loser_contact.sales_id),
    tags = merged_tags
  WHERE c.org_id = p_org_id AND c.id = winner_id;

  -- 6. Delete loser contact
  DELETE FROM crm.contacts c WHERE c.org_id = p_org_id AND c.id = loser_id;

  RETURN winner_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Global search (port of global_search)
--
-- Companies, contacts and deals are ranked by relevance (ts_rank): their name
-- is weighted A in fts, so a contact named John Doe ranks before one whose
-- background mentions John Doe. Ties, tasks and notes go newest first.
--
-- Each branch takes its own max_results best matches (at most 200), so the
-- union never holds more than 6 * max_results rows, and the lookups that build
-- display labels only run on those. The cap is per resource, not overall: an
-- old contact must not be crowded out by newer notes that mention its name.
-- `content` carries the searched fields in their original form, so the client
-- can show and highlight where the words matched.
--
-- force_custom_plan plans each call with the actual query: with a generic plan
-- the planner could not tell a rare word (use the GIN index) from a common one
-- (walk the date index), and could not skip the resources left out.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.global_search(p_org_id uuid, query text, resources text[] DEFAULT NULL::text[], max_results integer DEFAULT 50)
    RETURNS TABLE(resource text, record_id bigint, title text, subtitle text, contact_id bigint, deal_id bigint, date timestamptz, content text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    SET plan_cache_mode TO 'force_custom_plan'
    AS $$
#variable_conflict use_column
declare
    tsq tsquery := crm.search_query(query);
    row_limit constant integer := least(coalesce(max_results, 50), 200);
begin
    if p_org_id is null or tsq is null or row_limit < 1 then
        return;
    end if;

    return query
    select resource, record_id, title, subtitle, contact_id, deal_id, date, content
    from (
        (select 'companies' as resource, c.id as record_id, c.name as title, c.sector as subtitle,
            null::bigint as contact_id, null::bigint as deal_id, c.created_at as date,
            concat_ws(' · ', c.sector, c.description, c.website, c.phone_number, c.zipcode, c.city, c.state_abbr) as content,
            ts_rank(c.fts, tsq) as rank
        from crm.companies c
        where c.org_id = p_org_id and (resources is null or 'companies' = any(resources)) and c.fts @@ tsq
        order by rank desc, c.created_at desc
        limit row_limit)
        union all
        (select 'contacts', co.id, concat_ws(' ', co.first_name, co.last_name),
            (select cc.name from crm.companies cc where cc.org_id = p_org_id and cc.id = co.company_id), co.id, null::bigint, co.first_seen,
            concat_ws(' · ', co.title, co.background,
                (select string_agg(e ->> 'email', ' ') from jsonb_array_elements(co.email_jsonb) e),
                (select string_agg(p ->> 'number', ' ') from jsonb_array_elements(co.phone_jsonb) p)),
            ts_rank(co.fts, tsq) as rank
        from crm.contacts co
        where co.org_id = p_org_id and (resources is null or 'contacts' = any(resources)) and co.fts @@ tsq
        order by rank desc, co.first_seen desc nulls last
        limit row_limit)
        union all
        (select 'deals', d.id, d.name,
            (select dc.name from crm.companies dc where dc.org_id = p_org_id and dc.id = d.company_id), null::bigint, d.id, d.created_at,
            concat_ws(' · ', variadic d.categories || d.description),
            ts_rank(d.fts, tsq) as rank
        from crm.deals d
        where d.org_id = p_org_id and (resources is null or 'deals' = any(resources)) and d.archived_at is null and d.fts @@ tsq
        order by rank desc, d.created_at desc
        limit row_limit)
        union all
        (select 'tasks', t.id, left(t.text, 200),
            (select concat_ws(' ', tc.first_name, tc.last_name) from crm.contacts tc where tc.org_id = p_org_id and tc.id = t.contact_id),
            t.contact_id, null::bigint, t.created_at,
            concat_ws(' · ', t.text, t.type),
            0
        from crm.tasks t
        where t.org_id = p_org_id and (resources is null or 'tasks' = any(resources)) and t.done_date is null and t.fts @@ tsq
        order by t.created_at desc
        limit row_limit)
        union all
        (select 'contact_notes', cn.id, left(cn.text, 200),
            (select concat_ws(' ', nc.first_name, nc.last_name) from crm.contacts nc where nc.org_id = p_org_id and nc.id = cn.contact_id),
            cn.contact_id, null::bigint, cn.date,
            concat_ws(' · ', cn.text, crm.search_attachment_titles(cn.attachments)),
            0
        from crm.contact_notes cn
        where cn.org_id = p_org_id and (resources is null or 'contact_notes' = any(resources)) and cn.fts @@ tsq
        order by cn.date desc nulls last
        limit row_limit)
        union all
        (select 'deal_notes', dn.id, left(dn.text, 200), nd.name, null::bigint, dn.deal_id, dn.date,
            concat_ws(' · ', dn.text, crm.search_attachment_titles(dn.attachments)),
            0
        from crm.deal_notes dn
            join crm.deals nd on nd.org_id = dn.org_id and nd.id = dn.deal_id
        where dn.org_id = p_org_id and (resources is null or 'deal_notes' = any(resources)) and nd.archived_at is null and dn.fts @@ tsq
        order by dn.date desc nulls last
        limit row_limit)
    ) results
    order by rank desc, date desc nulls last;
end
$$;

-- ---------------------------------------------------------------------------
-- Views (port of 03_views.sql). security_invoker makes them obey the caller's
-- row-level policies; callers still filter by org_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW crm.activity_log WITH (security_invoker = on) AS
select
    c.org_id,
    ('company.' || c.id || '.created') as id,
    'company.created' as type,
    c.created_at as date,
    c.id as company_id,
    c.sales_id,
    (to_jsonb(c.*) - 'fts')::json as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note
from crm.companies c
union all
select
    co.org_id,
    ('contact.' || co.id || '.created') as id,
    'contact.created' as type,
    co.first_seen as date,
    co.company_id,
    co.sales_id,
    null::json as company,
    (to_jsonb(co.*) - 'fts')::json as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note
from crm.contacts co
union all
select
    cn.org_id,
    ('contactNote.' || cn.id || '.created') as id,
    'contactNote.created' as type,
    cn.date,
    co.company_id,
    cn.sales_id,
    null::json as company,
    null::json as contact,
    null::json as deal,
    (to_jsonb(cn.*) - 'fts')::json as contact_note,
    null::json as deal_note
from crm.contact_notes cn
    left join crm.contacts co on co.org_id = cn.org_id and co.id = cn.contact_id
union all
select
    d.org_id,
    ('deal.' || d.id || '.created') as id,
    'deal.created' as type,
    d.created_at as date,
    d.company_id,
    d.sales_id,
    null::json as company,
    null::json as contact,
    (to_jsonb(d.*) - 'fts')::json as deal,
    null::json as contact_note,
    null::json as deal_note
from crm.deals d
union all
select
    dn.org_id,
    ('dealNote.' || dn.id || '.created') as id,
    'dealNote.created' as type,
    dn.date,
    d.company_id,
    dn.sales_id,
    null::json as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    (to_jsonb(dn.*) - 'fts')::json as deal_note
from crm.deal_notes dn
    left join crm.deals d on d.org_id = dn.org_id and d.id = dn.deal_id;

CREATE OR REPLACE VIEW crm.companies_summary WITH (security_invoker = on) AS
select
    c.org_id,
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    count(distinct d.id) as nb_deals,
    count(distinct co.id) as nb_contacts
from crm.companies c
    left join crm.deals d on d.org_id = c.org_id and d.company_id = c.id
    left join crm.contacts co on co.org_id = c.org_id and co.company_id = c.id
group by c.id;

CREATE OR REPLACE VIEW crm.contacts_summary WITH (security_invoker = on) AS
select
    co.org_id,
    co.id,
    co.first_name,
    co.last_name,
    co.gender,
    co.title,
    co.background,
    co.avatar,
    co.first_seen,
    co.last_seen,
    co.has_newsletter,
    co.status,
    co.tags,
    co.company_id,
    co.sales_id,
    co.linkedin_url,
    co.email_jsonb,
    co.phone_jsonb,
    (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'))::text as email_fts,
    (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'))::text as phone_fts,
    c.name as company_name,
    count(distinct t.id) filter (where t.done_date is null) as nb_tasks
from crm.contacts co
    left join crm.tasks t on t.org_id = co.org_id and t.contact_id = co.id
    left join crm.companies c on c.org_id = co.org_id and c.id = co.company_id
group by co.id, c.name;

-- ---------------------------------------------------------------------------
-- Row-level security (replaces 05_policies.sql). One policy per table, for
-- every command: the row's org must be the request's org. FORCE applies it to
-- the table owner as well.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sales', 'tags', 'companies', 'contacts', 'contact_notes',
    'deals', 'deal_notes', 'tasks', 'favicons_excluded_domains'
  ]
  LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON crm.%I', tbl);
    EXECUTE format(
      'CREATE POLICY org_isolation ON crm.%I
         USING (org_id = (SELECT crm.current_org_id()))
         WITH CHECK (org_id = (SELECT crm.current_org_id()))',
      tbl
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Grants (replaces 06_grants.sql). Only crm_app is granted anything; Supabase's
-- anon and authenticated roles get no access to this schema.
-- ---------------------------------------------------------------------------

REVOKE ALL ON SCHEMA crm FROM PUBLIC;
GRANT USAGE ON SCHEMA crm TO crm_app;
GRANT USAGE ON SCHEMA extensions TO crm_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    crm.sales, crm.tags, crm.companies, crm.contacts, crm.contact_notes,
    crm.deals, crm.deal_notes, crm.tasks, crm.favicons_excluded_domains
    TO crm_app;
GRANT SELECT ON crm.activity_log, crm.companies_summary, crm.contacts_summary TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA crm TO crm_app;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA crm FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO crm_app;
