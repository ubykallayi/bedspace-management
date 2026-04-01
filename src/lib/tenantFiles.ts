import { supabase } from './supabase';

const TENANT_FILES_BUCKET = 'tenant-files';

export const uploadTenantAsset = async ({
  tenantId,
  file,
  assetType,
}: {
  tenantId: string;
  file: File;
  assetType: 'photo' | 'document';
}) => {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : '';
  const safeExtension = extension ? `.${extension.toLowerCase()}` : '';
  const filePath = `${tenantId}/${assetType}-${Date.now()}${safeExtension}`;

  const { error: uploadError } = await supabase.storage
    .from(TENANT_FILES_BUCKET)
    .upload(filePath, file, { upsert: true });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage
    .from(TENANT_FILES_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
};
