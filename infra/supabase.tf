# analyses table — created via psql since postgresql_table has limited DDL support
resource "null_resource" "analyses_table" {
  triggers = {
    schema_hash = sha256(<<-SQL
      CREATE TABLE IF NOT EXISTS public.analyses (
        id           SERIAL PRIMARY KEY,
        type         TEXT        NOT NULL,
        workout_id   TEXT        NOT NULL UNIQUE,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        content      TEXT        NOT NULL,
        model        TEXT        NOT NULL,
        tokens_used  INTEGER
      );
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO service_role;
    SQL
    )
  }

  provisioner "local-exec" {
    command = <<-BASH
      PGPASSWORD="${var.supabase_db_password}" psql \
        "host=${var.supabase_db_host} port=5432 dbname=postgres user=postgres sslmode=require" \
        -c "
          CREATE TABLE IF NOT EXISTS public.analyses (
            id           SERIAL PRIMARY KEY,
            type         TEXT        NOT NULL,
            workout_id   TEXT        NOT NULL UNIQUE,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            content      TEXT        NOT NULL,
            model        TEXT        NOT NULL,
            tokens_used  INTEGER
          );
          GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO service_role;
        "
    BASH
  }
}

# Supabase Storage bucket — created via Management REST API
# (supabase/supabase Terraform provider v1 does not include a storage bucket resource)
resource "null_resource" "hevy_analytics_bucket" {
  triggers = {
    bucket_name = var.supabase_bucket
  }

  provisioner "local-exec" {
    command = <<-BASH
      curl -sf -X POST "${var.supabase_url}/storage/v1/bucket" \
        -H "Authorization: Bearer ${var.supabase_service_key}" \
        -H "Content-Type: application/json" \
        -d '{"id":"${var.supabase_bucket}","name":"${var.supabase_bucket}","public":false,"fileSizeLimit":52428800}' \
        -o /dev/null \
        && echo "bucket ${var.supabase_bucket} created" \
        || echo "bucket ${var.supabase_bucket} may already exist — continuing"
    BASH
  }
}
