#!/usr/bin/env python3
"""Deploy Infrastructure - Cloudflare Setup"""
import subprocess
import sys
from pathlib import Path

def run(cmd, description=""):
    """Execute command and return success status"""
    if description:
        print(f"\n📦 {description}")
    print(f"$ {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result.returncode == 0

def main():
    print("="*70)
    print("RELENTLESS BILLIONAIRE - INFRASTRUCTURE DEPLOYMENT")
    print("="*70)
    
    root = Path(__file__).parent
    os.chdir(root)
    
    # Prerequisites check
    checks = [
        ("node --version", "Node.js"),
        ("npx wrangler --version", "Wrangler CLI"),
        ("python --version", "Python")
    ]
    
    print("\n🔍 Checking prerequisites...")
    for cmd, name in checks:
        if run(cmd):
            print(f"✅ {name} found")
        else:
            print(f"⚠️  {name} not found")
    
    # Install Wrangler if needed
    if not run("npx wrangler --version"):
        print("\n📥 Installing Wrangler...")
        run("npm install -g wrangler")
    
    # Cloudflare setup instructions
    print("\n" + "="*70)
    print("CLOUDFLARE SETUP INSTRUCTIONS")
    print("="*70)
    print("""
1. LOGIN TO CLOUDFLARE:
   npx wrangler login

2. CREATE D1 DATABASE:
   npx wrangler d1 create relentless-billionaire-db
   → Copy the database_id to wrangler.toml

3. CREATE R2 BUCKET:
   npx wrangler r2 bucket create relentless-billionaire-models

4. CREATE KV NAMESPACE:
   npx wrangler kv:namespace create CACHE
   → Copy the id to wrangler.toml

5. UPDATE wrangler.toml:
   - Replace YOUR_D1_DATABASE_ID with actual ID
   - Replace YOUR_KV_NAMESPACE_ID with actual ID

6. DEPLOY WORKER:
   npx wrangler deploy

7. VERIFY DEPLOYMENT:
   npx wrangler tail
    """)
    
    # Attempt auto-deploy
    print("\n" + "="*70)
    response = input("Ready to deploy? (y/n): ").lower().strip()
    
    if response == 'y':
        print("\n🚀 Deploying to Cloudflare...")
        if run("npx wrangler deploy", "Worker Deployment"):
            print("\n✅ Deployment successful!")
            print("\nYour worker is now live at: https://relentless-billionaire.workers.dev")
        else:
            print("\n❌ Deployment failed. Check configuration and try again.")
    else:
        print("\n⏸️  Deployment skipped. Run 'npx wrangler deploy' manually when ready.")
    
    print("\n" + "="*70)

if __name__ == "__main__":
    import os
    main()
