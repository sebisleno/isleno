import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';
const ATTACHMENT_MODEL = 'ir.attachment';

/**
 * Force re-link the attachment by clearing and re-setting message_main_attachment_id
 * This might trigger Odoo to re-validate the attachment
 */
export async function POST(
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

    // Get current attachment
    const invoice = await odooApi.searchRead(INVOICE_MODEL, [
      ["id", "=", invoiceId]
    ], {
      fields: ["id", "message_main_attachment_id"]
    });

    if (invoice.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const currentAttachmentId = Array.isArray(invoice[0].message_main_attachment_id)
      ? invoice[0].message_main_attachment_id[0]
      : invoice[0].message_main_attachment_id;

    if (!currentAttachmentId) {
      return NextResponse.json({ error: 'No attachment to relink' }, { status: 400 });
    }

    console.log(`Force re-linking attachment ${currentAttachmentId} to invoice ${invoiceId}...`);

    // Step 1: Clear the message_main_attachment_id
    await odooApi.write(INVOICE_MODEL, [invoiceId], {
      message_main_attachment_id: false
    });
    console.log('Cleared message_main_attachment_id');

    // Step 2: Re-set it (this might trigger validation)
    await odooApi.write(INVOICE_MODEL, [invoiceId], {
      message_main_attachment_id: currentAttachmentId
    });
    console.log(`Re-linked attachment ${currentAttachmentId}`);

    // Step 3: Try to trigger OCR
    try {
      await odooApi.executeKw(
        'account.move',
        'action_reload_ai_data',
        [[invoiceId]]
      );
      console.log('OCR triggered successfully');
      
      return NextResponse.json({
        success: true,
        message: 'Attachment re-linked and OCR triggered',
        attachmentId: currentAttachmentId
      });
    } catch (ocrError: any) {
      return NextResponse.json({
        success: false,
        message: 'Attachment re-linked but OCR failed',
        attachmentId: currentAttachmentId,
        ocrError: ocrError.message
      });
    }
  } catch (error: any) {
    console.error('Failed to force relink:', error);
    return NextResponse.json(
      { 
        error: 'Failed to force relink',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




