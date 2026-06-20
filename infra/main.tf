terraform {
  required_version = ">= 1.6"

  required_providers {
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.22"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "postgresql" {
  host     = var.supabase_db_host
  port     = 5432
  database = "postgres"
  username = "postgres"
  password = var.supabase_db_password
  sslmode  = "require"
  superuser = false
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "github" {
  token = var.github_token
  owner = var.github_owner
}
