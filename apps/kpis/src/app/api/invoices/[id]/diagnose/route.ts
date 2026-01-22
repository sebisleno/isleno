import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';
const ATTACHMENT_MODEL = 'ir.attachment';

/**
 * Diagnostic endpoint to check invoice attachment status
 * Helps troubleshoot "document not found" issues
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

    // Fetch invoice with attachment-related fields
    const invoiceData = await odooApi.searchRead(INVOICE_MODEL, [
      ["id", "=", invoiceId]
    ], {
      fields: [
        "id", 
        "name", 
        "state",
        "amount_untaxed", 
        "message_main_attachment_id",
        "partner_id",
        "invoice_date"
      ]
    });

    if (!invoiceData || invoiceData.length === 0) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const invoice = invoiceData[0];

    // Check for attachments
    const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, [
      ["res_model", "=", INVOICE_MODEL],
      ["res_id", "=", invoiceId]
    ], {
      fields: ["id", "name", "mimetype", "create_date"]
    });

    // Analyze the situation
    const hasAttachments = attachments.length > 0;
    const hasMainAttachmentId = invoice.message_main_attachment_id && 
                                (Array.isArray(invoice.message_main_attachment_id) ? 
                                 invoice.message_main_attachment_id[0] : 
                                 invoice.message_main_attachment_id);
    const hasZeroValue = !invoice.amount_untaxed || invoice.amount_untaxed === 0;
    const isCancelled = invoice.state === 'cancel';

    // Determine the issue
    let issue = null;
    let recommendation = null;

    if (isCancelled) {
      issue = 'Invoice is cancelled';
      recommendation = 'Cancelled invoices are excluded from processing';
    } else if (!hasAttachments) {
      issue = 'No attachments found';
      recommendation = 'This invoice has no attachments to process. Upload an attachment in Odoo first.';
    } else if (!hasMainAttachmentId) {
      issue = 'Attachment exists but message_main_attachment_id is not set';
      recommendation = 'Call POST /api/invoices/' + invoiceId + '/refresh-ocr to link the attachment and trigger OCR';
    } else if (hasZeroValue) {
      issue = 'Attachment is linked but OCR has not populated values';
      recommendation = 'Call POST /api/invoices/' + invoiceId + '/refresh-ocr to trigger OCR processing';
    } else {
      issue = null;
      recommendation = 'Invoice appears to be properly configured';
    }

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        name: invoice.name,
        state: invoice.state,
        amount_untaxed: invoice.amount_untaxed,
        message_main_attachment_id: invoice.message_main_attachment_id
      },
      attachments: attachments.map(att => ({
        id: att.id,
        name: att.name,
        mimetype: att.mimetype,
        created: att.create_date
      })),
      diagnosis: {
        hasAttachments,
        hasMainAttachmentId,
        hasZeroValue,
        isCancelled,
        issue,
        recommendation
      },
      actions: {
        fixAttachmentLinkage: `/api/invoices/${invoiceId}/refresh-ocr`,
        bulkFix: `/api/invoices/fix-attachments (POST with invoiceIds: [${invoiceId}])`
      }
    });
  } catch (error: any) {
    console.error('Failed to diagnose invoice:', error);
    return NextResponse.json(
      { 
        error: 'Failed to diagnose invoice',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




