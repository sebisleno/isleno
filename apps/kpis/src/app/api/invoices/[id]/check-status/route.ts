import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';

/**
 * Call check_all_status correctly - this might be what refreshes document access
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

    // Call check_all_status on the invoice (method of ExtractMixin)
    // This should be called on the recordset, not with the ID as parameter
    const result = await odooApi.executeKw(
      INVOICE_MODEL,
      'check_all_status',
      [invoiceId]  // Pass as first arg, not in array
    );

    return NextResponse.json({
      success: true,
      message: 'check_all_status called successfully',
      result
    });
  } catch (error: any) {
    console.error('Failed to check status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check status',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




