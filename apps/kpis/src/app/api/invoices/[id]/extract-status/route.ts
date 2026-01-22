import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';

/**
 * Check OCR/Extract status fields
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

    // Try to get extract-related fields
    const invoice = await odooApi.searchRead(INVOICE_MODEL, [
      ["id", "=", invoiceId]
    ], {
      fields: [
        "id",
        "extract_state",
        "extract_status_code", 
        "extract_remote_id",
        "extract_error_message",
        "duplicated_vendor_ref",
        "message_main_attachment_id",
        "state",
        "amount_untaxed"
      ]
    });

    if (invoice.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    return NextResponse.json({
      invoice: invoice[0],
      interpretation: {
        extract_state: invoice[0].extract_state || 'Not set (field might not exist)',
        has_attachment: !!invoice[0].message_main_attachment_id,
        is_zero_value: !invoice[0].amount_untaxed || invoice[0].amount_untaxed === 0
      }
    });
  } catch (error: any) {
    console.error('Failed to check extract status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check extract status',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




