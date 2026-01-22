import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const ATTACHMENT_MODEL = 'ir.attachment';

/**
 * Deep check of attachment data to diagnose "document not found" issues
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = parseInt(id, 10);
    
    if (isNaN(invoiceId)) {
      return NextResponse.json(
        { error: 'Invalid invoice ID' },
        { status: 400 }
      );
    }

    // Get ALL fields from the attachment to see what's there
    const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, [
      ["res_model", "=", "account.move"],
      ["res_id", "=", invoiceId]
    ], {
      fields: [
        "id",
        "name", 
        "datas",
        "mimetype",
        "file_size",
        "checksum",
        "store_fname",
        "db_datas",
        "access_token",
        "public",
        "type",
        "url",
        "create_date",
        "write_date"
      ]
    });

    if (attachments.length === 0) {
      return NextResponse.json({
        error: 'No attachments found for this invoice'
      }, { status: 404 });
    }

    const attachment = attachments[0];
    
    // Analyze the attachment
    const hasData = attachment.datas && attachment.datas.length > 0;
    const hasDbData = attachment.db_datas && attachment.db_datas.length > 0;
    const hasStoreFile = attachment.store_fname && attachment.store_fname.length > 0;
    const hasAccessToken = attachment.access_token && attachment.access_token.length > 0;
    const dataLength = attachment.datas ? attachment.datas.length : 0;
    
    // Determine storage type
    let storageType = 'unknown';
    if (hasStoreFile) {
      storageType = 'filestore';
    } else if (hasDbData || hasData) {
      storageType = 'database';
    }

    return NextResponse.json({
      attachment: {
        id: attachment.id,
        name: attachment.name,
        mimetype: attachment.mimetype,
        file_size: attachment.file_size,
        checksum: attachment.checksum,
        type: attachment.type,
        public: attachment.public,
        url: attachment.url,
        created: attachment.create_date,
        modified: attachment.write_date
      },
      storage: {
        type: storageType,
        store_fname: attachment.store_fname,
        has_datas: hasData,
        has_db_datas: hasDbData,
        datas_length: dataLength,
        has_access_token: hasAccessToken,
        access_token: hasAccessToken ? attachment.access_token : null
      },
      diagnosis: {
        can_be_downloaded: hasData || hasDbData || hasStoreFile,
        has_content: hasData || hasDbData || hasStoreFile,
        is_accessible: hasAccessToken || attachment.public,
        issue: !hasData && !hasDbData && !hasStoreFile 
          ? "Attachment record exists but has no actual file data" 
          : (!hasAccessToken && !attachment.public)
          ? "Attachment has no access_token and is not public"
          : null
      },
      recommendation: !hasData && !hasDbData && !hasStoreFile
        ? "The attachment is corrupted or was not properly uploaded. Re-upload the document in Odoo."
        : (!hasAccessToken && !attachment.public)
        ? "Generate access token: call odooApi.executeKw('ir.attachment', 'generate_access_token', [[" + attachment.id + "]])"
        : "Attachment appears valid. The issue may be with Odoo's IAP/Extract service configuration."
    });
  } catch (error: any) {
    console.error('Failed to check attachment:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check attachment',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




