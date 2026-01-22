import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';
const ATTACHMENT_MODEL = 'ir.attachment';

/**
 * Try different methods to trigger document digitization
 * Attempting to replicate what the "Retry" button does in Odoo
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

    const results: any[] = [];

    // Method 1: Try button_digitize (common method name for digitization buttons)
    try {
      console.log('Trying button_digitize...');
      const result1 = await odooApi.executeKw(INVOICE_MODEL, 'button_digitize', [[invoiceId]]);
      results.push({ method: 'button_digitize', success: true, result: result1 });
    } catch (e: any) {
      results.push({ method: 'button_digitize', success: false, error: e.message });
    }

    // Method 2: Try action_digitize
    try {
      console.log('Trying action_digitize...');
      const result2 = await odooApi.executeKw(INVOICE_MODEL, 'action_digitize', [[invoiceId]]);
      results.push({ method: 'action_digitize', success: true, result: result2 });
    } catch (e: any) {
      results.push({ method: 'action_digitize', success: false, error: e.message });
    }

    // Method 3: Try retry_extraction
    try {
      console.log('Trying retry_extraction...');
      const result3 = await odooApi.executeKw(INVOICE_MODEL, 'retry_extraction', [[invoiceId]]);
      results.push({ method: 'retry_extraction', success: true, result: result3 });
    } catch (e: any) {
      results.push({ method: 'retry_extraction', success: false, error: e.message });
    }

    // Method 4: Try _retry_digitization
    try {
      console.log('Trying _retry_digitization...');
      const result4 = await odooApi.executeKw(INVOICE_MODEL, '_retry_digitization', [[invoiceId]]);
      results.push({ method: '_retry_digitization', success: true, result: result4 });
    } catch (e: any) {
      results.push({ method: '_retry_digitization', success: false, error: e.message });
    }

    // Method 5: Try action_send_and_print (sometimes used for processing)
    try {
      console.log('Trying action_send_and_print...');
      const result5 = await odooApi.executeKw(INVOICE_MODEL, 'action_send_and_print', [[invoiceId]]);
      results.push({ method: 'action_send_and_print', success: true, result: result5 });
    } catch (e: any) {
      results.push({ method: 'action_send_and_print', success: false, error: e.message });
    }

    // Method 6: Try check_all_status (might refresh document status)
    try {
      console.log('Trying check_all_status...');
      const result6 = await odooApi.executeKw(INVOICE_MODEL, 'check_all_status', [[invoiceId]]);
      results.push({ method: 'check_all_status', success: true, result: result6 });
    } catch (e: any) {
      results.push({ method: 'check_all_status', success: false, error: e.message });
    }

    // Method 7: Try _extend_with_attachments (might refresh attachment linkage)
    try {
      console.log('Trying _extend_with_attachments...');
      const result7 = await odooApi.executeKw(INVOICE_MODEL, '_extend_with_attachments', [[invoiceId]]);
      results.push({ method: '_extend_with_attachments', success: true, result: result7 });
    } catch (e: any) {
      results.push({ method: '_extend_with_attachments', success: false, error: e.message });
    }

    const successfulMethods = results.filter(r => r.success);
    const failedMethods = results.filter(r => !r.success);

    return NextResponse.json({
      invoiceId,
      summary: {
        total: results.length,
        successful: successfulMethods.length,
        failed: failedMethods.length
      },
      successfulMethods,
      failedMethods: failedMethods.map(r => ({ method: r.method, error: r.error })),
      recommendation: successfulMethods.length > 0
        ? `Found ${successfulMethods.length} working method(s). Use: ${successfulMethods.map(r => r.method).join(', ')}`
        : 'No working methods found. May need to check Odoo configuration or IAP credits.'
    });
  } catch (error: any) {
    console.error('Failed to retry digitization:', error);
    return NextResponse.json(
      { 
        error: 'Failed to retry digitization',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




