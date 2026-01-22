import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';

/**
 * Check what methods are available on account.move
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

    // Get available methods on the model
    const methods = await odooApi.executeKw(
      INVOICE_MODEL,
      'fields_get',
      [],
      { attributes: ['string', 'help', 'type'] }
    );

    // Try to get methods specifically (this might not work but worth trying)
    let modelMethods: any = {};
    try {
      // This attempts to introspect the model
      modelMethods = await odooApi.executeKw(
        'ir.model',
        'search_read',
        [[['model', '=', INVOICE_MODEL]]],
        { fields: ['name', 'model', 'info', 'modules'] }
      );
    } catch (e) {
      console.log('Could not get model methods:', e);
    }

    // Check if specific OCR-related methods exist by trying to call them with wrong params
    const ocrMethods = [];
    const methodsToTest = [
      'action_reload_ai_data',
      'retry_ocr',
      'extract_data', 
      'check_status',
      'retry_extract',
      'action_send_for_digitization',
      'extract_partner',
      'extract_single',
      '_check_digitalization_readiness'
    ];

    for (const method of methodsToTest) {
      try {
        // Try to call with empty array - if method exists, we'll get an error but know it exists
        await odooApi.executeKw(INVOICE_MODEL, method, [[]]);
        ocrMethods.push({ method, exists: true, tested: true });
      } catch (error: any) {
        const errorMsg = error.message || '';
        // If error mentions the method doesn't exist, it doesn't exist
        if (errorMsg.includes('does not exist') || errorMsg.includes('object has no attribute')) {
          ocrMethods.push({ method, exists: false, error: errorMsg });
        } else {
          // Other error means method exists but we called it wrong
          ocrMethods.push({ method, exists: true, error: errorMsg });
        }
      }
    }

    return NextResponse.json({
      modelInfo: modelMethods,
      availableFields: Object.keys(methods).slice(0, 20), // Just show first 20
      ocrMethods,
      invoiceId
    });
  } catch (error: any) {
    console.error('Failed to check methods:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check methods',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




