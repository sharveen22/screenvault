# ScreenVault Marketing Website

This directory contains the marketing landing page for ScreenVault, separate from the Electron app.

## 📁 Structure

```
website/
├── index.html        # Landing page (main entry point)
├── download.html     # Download confirmation page
├── assets/           # Images, logos, and other assets
│   ├── camera.png
│   ├── app-hero-screenshot-*.png
│   └── app-hero-screenshot-*.webp
└── README.md         # This file
```

## 🚀 Deployment

### Deploy to Vercel (Recommended)

The repository is already configured for Vercel deployment via the `vercel.json` file in the root directory.

**Option 1: Automatic Deployment (GitHub Integration)**
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your `screenvault` GitHub repository
4. Vercel will automatically detect the configuration
5. Click "Deploy"

**Option 2: Vercel CLI**
```bash
# Install Vercel CLI (first time only)
npm i -g vercel

# Deploy from repository root
cd /path/to/screenvault
vercel

# For production deployment
vercel --prod
```

### Deploy to Netlify

**Option 1: Drag & Drop**
1. Go to [netlify.com](https://netlify.com)
2. Drag the `website/` folder to the upload area
3. Done!

**Option 2: Netlify CLI**
```bash
# Install Netlify CLI (first time only)
npm i -g netlify-cli

# Deploy from website directory
cd website/
netlify deploy

# For production deployment
netlify deploy --prod
```

**Option 3: netlify.toml Configuration**
Add this file to the repository root:
```toml
[build]
  publish = "website"
  command = "echo 'No build needed'"

[[redirects]]
  from = "/download"
  to = "/download.html"
  status = 200
```

### Deploy to GitHub Pages

**Option 1: GitHub Actions (Automatic)**
Create `.github/workflows/deploy-website.yml`:
```yaml
name: Deploy Website
on:
  push:
    branches: [main]
    paths:
      - 'website/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./website
```

**Option 2: Manual Deployment**
```bash
# Create gh-pages branch with website content
git checkout --orphan gh-pages
git rm -rf .
cp -r website/* .
git add .
git commit -m "Deploy website"
git push origin gh-pages

# Go to repo Settings > Pages > Source > gh-pages branch
```

### Deploy to Cloudflare Pages

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click "Pages" > "Create a project"
3. Connect your GitHub repository
4. Configure:
   - Build command: `echo 'No build needed'`
   - Build output directory: `website`
5. Click "Save and Deploy"

## 🔧 Configuration

### Vercel Configuration

The `vercel.json` in the repository root is configured to:
- Serve files from the `website/` directory
- Enable clean URLs (no `.html` extension needed)
- Add security headers
- Rewrite `/download` to `/download.html`

### Custom Domain

**Vercel:**
1. Go to your project settings
2. Click "Domains"
3. Add your custom domain
4. Update DNS records as instructed

**Netlify:**
1. Go to "Domain settings"
2. Add custom domain
3. Follow DNS configuration steps

## 📝 Development

To test locally:

```bash
# Option 1: Python HTTP Server
cd website/
python3 -m http.server 8000
# Visit http://localhost:8000

# Option 2: Node.js HTTP Server
npx http-server website/ -p 8000

# Option 3: Live Server (VS Code Extension)
# Right-click index.html > "Open with Live Server"
```

## 🔗 URLs

After deployment, your URLs will be:
- Homepage: `https://yourdomain.com/` (serves `index.html`)
- Download page: `https://yourdomain.com/download` (serves `download.html`)

## 📦 Asset Management

To add new images or assets:
1. Place files in `website/assets/`
2. Reference in HTML: `<img src="assets/your-image.png">`
3. For root-level assets (like favicon): `<link rel="icon" href="/favicon.ico">`

## 🔄 Updates

To update the website:
1. Edit files in the `website/` directory
2. Commit and push changes
3. Vercel/Netlify will auto-deploy (if using Git integration)
4. Or manually redeploy using CLI

## 📧 Form Submissions

The download form submits to Formspree:
- Endpoint: `https://formspree.io/f/mldqwrkd`
- Form data includes: name, email, use case, timestamp
- After submission, redirects to `/download`

To change form endpoint:
- Edit line 1260 in `index.html`
- Replace with your Formspree or custom endpoint

## 🐛 Troubleshooting

**Issue: 404 on Vercel**
- Check `vercel.json` has `"outputDirectory": "website"`
- Ensure files exist in `website/` directory

**Issue: Assets not loading**
- Use relative paths: `assets/image.png` (not `/assets/image.png`)
- Or absolute paths: `/assets/image.png` (with leading slash)

**Issue: Clean URLs not working**
- Ensure `"cleanUrls": true` in `vercel.json`
- For Netlify, use `[[redirects]]` in `netlify.toml`

## 📚 Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Netlify Documentation](https://docs.netlify.com)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages)

---

**Note:** This website is completely separate from the Electron app. Changes here do not affect the desktop application.
