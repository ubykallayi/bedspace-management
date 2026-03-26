# Supabase Setup Guide

Follow these instructions to set up your Supabase backend for the **Bed Space Management** application.

### 1. Create a Project
1. Go to [Supabase](https://supabase.com/).
2. Click **Start your project** and sign in.
3. Click **New project**, choose an organization, and give your project a name (e.g., "BedSpace App").
4. Choose a strong database password and click **Create new project**.

### 2. Run the SQL Setup Script
1. Once your project is created, navigate to the **SQL Editor** on the left menu bar.
2. Click **New query** and paste the following SQL code exactly as it is:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Create Users Table
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  role text not null check (role in ('admin', 'tenant')) default 'tenant',
  email text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.users enable row level security;
create policy "Users can view their own data and admin can view all"
  on public.users for select
  using ( auth.uid() = id or (select role from public.users where id = auth.uid()) = 'admin' );

-- Create trigger to automatically add a new Auth User to the public.users table (optional/advanced, we will handle this in app)

-- 2. Create Rooms Table
create table public.rooms (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.rooms enable row level security;
create policy "Anyone can read rooms" on public.rooms for select to authenticated using (true);
create policy "Only admin can modify rooms" on public.rooms for all
  using ( (select role from public.users where id = auth.uid()) = 'admin' );

-- 3. Create Beds Table
create table public.beds (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  bed_number text not null,
  rent numeric not null default 0,
  status text not null check (status in ('vacant', 'occupied')) default 'vacant',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.rooms enable row level security;
create policy "Anyone can read beds" on public.beds for select to authenticated using (true);
create policy "Only admin can modify beds" on public.beds for all
  using ( (select role from public.users where id = auth.uid()) = 'admin' );

-- 4. Create Tenants Table
create table public.tenants (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  bed_id uuid references public.beds(id) on delete restrict,
  rent_amount numeric not null,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  updated_at timestamp with time zone,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.tenants enable row level security;
create policy "Admins can view all tenants, tenant can view their own" on public.tenants for select
  using (
    auth.uid() = user_id
    or email = (select email from public.users where id = auth.uid())
    or (select role from public.users where id = auth.uid()) = 'admin'
  );
create policy "Only admin can modify tenants" on public.tenants for all
  using ( (select role from public.users where id = auth.uid()) = 'admin' );
create policy "Tenant can link their own email booking" on public.tenants for update
  using (email = (select email from public.users where id = auth.uid()))
  with check (email = (select email from public.users where id = auth.uid()) and user_id = auth.uid());

-- 5. Create Payments Table
create table public.payments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  amount numeric not null,
  status text not null check (status in ('paid', 'pending')) default 'pending',
  billing_month date not null,
  payment_date date not null,
  updated_at timestamp with time zone,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.payments enable row level security;
create policy "Admins can view all payments, tenant can view their own" on public.payments for select
  using ( 
    (select role from public.users where id = auth.uid()) = 'admin'
    or tenant_id in (select id from public.tenants where user_id = auth.uid())
  );
create policy "Only admin can modify payments" on public.payments for all
  using ( (select role from public.users where id = auth.uid()) = 'admin' );

-- 6. App Settings Table
create table public.app_settings (
  id integer primary key check (id = 1),
  site_name text not null default 'BedSpace',
  currency_code text not null default 'AED',
  currency_symbol text not null default 'AED',
  company_name text not null default 'BedSpace',
  support_email text not null default '',
  support_phone text not null default '',
  timezone text not null default 'Asia/Dubai',
  updated_at timestamp with time zone,
  updated_by uuid references public.users(id) on delete set null
);
insert into public.app_settings (id) values (1)
on conflict (id) do nothing;
alter table public.app_settings enable row level security;
create policy "Anyone authenticated can read app settings" on public.app_settings for select to authenticated using (true);
create policy "Only admin can modify app settings" on public.app_settings for all
  using ( (select role from public.users where id = auth.uid()) = 'admin' );

-- 7. Optional but Recommended: Activity Log Table
create table public.activity_logs (
  id uuid default uuid_generate_v4() primary key,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  description text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.activity_logs enable row level security;
create policy "Admins can view activity logs" on public.activity_logs for select
  using ( (select role from public.users where id = auth.uid()) = 'admin' );
create policy "Only admin can insert activity logs" on public.activity_logs for insert
  with check ( (select role from public.users where id = auth.uid()) = 'admin' );
```

3. Click **Run** on the bottom right. This will create all the necessary tables and set up row-level security (so tenants can't view admin data).

### 3. Retrieve Environment Variables
1. Go to **Project Settings** (the gear icon) on the left sidebar.
2. Select **API** under Configuration.
3. You need to copy two values:
   - **Project URL** -> `VITE_SUPABASE_URL`
   - **Project API Keys (anon public)** -> `VITE_SUPABASE_ANON_KEY`

### 4. Setup in the Code
Create a `.env` file in the root of your React application (`g:\My Drive\Important & Personal Documents\Bed Space Management Web\.env`) and paste the variables:
```env
VITE_SUPABASE_URL=your_project_url_here
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

### 5. Final Step: Creating an Admin Account
To create an admin:
1. Sign up normally through the app's register page.
2. Go to your Supabase project -> **Table Editor** -> `users` table.
3. Find your user row, edit it, and change the `role` column to `'admin'`.
4. Now you have full access to the dashboard.

### 6. If Your Project Already Exists
If your database was created before the latest admin updates, run this migration too:

```sql
alter table public.beds
add column if not exists rent numeric default 0 not null;

alter table public.tenants
add column if not exists is_active boolean default true not null;

alter table public.tenants
add column if not exists updated_at timestamp with time zone;

alter table public.tenants
add column if not exists updated_by uuid references public.users(id) on delete set null;

alter table public.payments
add column if not exists updated_at timestamp with time zone;

alter table public.payments
add column if not exists updated_by uuid references public.users(id) on delete set null;

create table if not exists public.app_settings (
  id integer primary key check (id = 1),
  site_name text not null default 'BedSpace',
  currency_code text not null default 'AED',
  currency_symbol text not null default 'AED',
  company_name text not null default 'BedSpace',
  support_email text not null default '',
  support_phone text not null default '',
  timezone text not null default 'Asia/Dubai',
  updated_at timestamp with time zone,
  updated_by uuid references public.users(id) on delete set null
);

insert into public.app_settings (id) values (1)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "Anyone authenticated can read app settings" on public.app_settings;
create policy "Anyone authenticated can read app settings" on public.app_settings for select to authenticated using (true);

drop policy if exists "Only admin can modify app settings" on public.app_settings;
create policy "Only admin can modify app settings" on public.app_settings for all
  using ( (select role from public.users where id = auth.uid()) = 'admin' );

create table if not exists public.activity_logs (
  id uuid default uuid_generate_v4() primary key,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  description text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.activity_logs enable row level security;

drop policy if exists "Admins can view activity logs" on public.activity_logs;
create policy "Admins can view activity logs" on public.activity_logs for select
  using ( (select role from public.users where id = auth.uid()) = 'admin' );

drop policy if exists "Only admin can insert activity logs" on public.activity_logs;
create policy "Only admin can insert activity logs" on public.activity_logs for insert
  with check ( (select role from public.users where id = auth.uid()) = 'admin' );
```
