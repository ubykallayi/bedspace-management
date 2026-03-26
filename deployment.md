# Deployment Guide (Vercel)

Deploying this React app to Vercel is highly recommended and straightforward.

### Prerequisites
1. A **GitHub**, **GitLab**, or **Bitbucket** account protecting your code repository.
2. A **Vercel** account (you can sign up with your Git provider).

### Step 1: Push your Code to GitHub
1. Open up your terminal in this repository.
2. Run standard git commands to initialize and push your repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   # Add your github remote (e.g. git remote add origin https://github.com/yourusername/reponame.git)
   git push -u origin main
   ```

### Step 2: Import into Vercel
1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click on **Add New...** and select **Project**.
3. Under "Import Git Repository", securely connect your GitHub account and find the repository you just pushed.
4. Click **Import**.

### Step 3: Configure Project setup
1. Name your project (or keep it the default based on your repo name).
2. Ensure **Framework Preset** is set to **Vite** (Vercel usually detects this automatically).
3. Open the **Environment Variables** tab.
4. Add the Supabase credentials you copied from your `.env` file:
   - Name: `VITE_SUPABASE_URL`, Value: `(your project url)`
   - Name: `VITE_SUPABASE_ANON_KEY`, Value: `(your anon key)`
5. Click **Deploy**.

### Step 4: Done!
Vercel will build the frontend and deploy it. It will give you live URLs that update securely every time you push new code to the `main` branch.
