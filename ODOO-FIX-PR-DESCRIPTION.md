# Fix: Odoo "Document Not Found" Issue - Automatic Attachment Linking

## Summary

This PR resolves the critical issue where invoices added to Odoo via API with attachments display a "The document could not be found -> Retry" message, preventing automatic OCR processing and leaving invoice details (price, date, supplier) empty.

## Problem

When invoices are added via the Odoo API with attachments:
- Odoo shows "The document could not be found" error
- Manually clicking "Retry" loads the document and triggers OCR successfully
- Without manual intervention, OCR never triggers
- Invoice details remain empty, blocking the approval process

## Root Cause

The issue occurs because Odoo doesn't immediately populate the `message_main_attachment_id` field on the invoice when attachments are uploaded via API. The OCR service (`action_reload_ai_data`) requires this field to locate and process documents.

## Solution

Implemented automatic attachment linking that programmatically sets `message_main_attachment_id` before triggering OCR, mimicking what the "Retry" button does manually.

## Changes Made

### 1. Modified OCR Refresh Logic (`apps/kpis/src/lib/odoo/services.ts`)

- Added `ensureInvoiceAttachmentLinkage()` function that:
  - Checks if `message_main_attachment_id` is already set
  - Searches for attachments linked to the invoice
  - Links the first available attachment if needed
  - Returns success/failure status

- Updated `refreshOcrDataForInvoices()` to:
  - Call attachment linkage before OCR processing
  - Skip invoices without attachments
  - Provide detailed logging and error tracking
  - Report attachment linkage status in results

- Enhanced **`getInvoice()`** with automatic OCR triggering:
  - Detects invoices with zero values + attachments when loaded
  - Automatically links attachments if `message_main_attachment_id` is missing
  - Triggers OCR processing immediately
  - **Works for single invoice detail views** - fixes issues when opening individual invoices
  - Non-blocking: triggers OCR but doesn't wait (OCR takes 5-30 seconds)

- Added **pre-filtering logic** to prevent repeated processing:
  - Only invoices with attachments are sent for OCR processing
  - Invoices legitimately created without attachments are excluded
  - Prevents endless API calls on invoices that don't need OCR
  - Improves performance and reduces unnecessary load

- Added **cancelled invoice filtering** across all invoice fetch functions:
  - `getAllInvoices()`, `getInvoice()`, `getPendingInvoices()`, `getInvoiceCount()`, `getOtherInvoices()`
  - Filters applied at the Odoo API level using `["state", "!=", "cancel"]`
  - Reduces data transfer and processing overhead
  - Note: `getSentForPaymentInvoices()` and `getPaidInvoices()` inherently exclude cancelled by their state filters

### 2. Enhanced Single Invoice Refresh (`apps/kpis/src/app/api/invoices/[id]/refresh-ocr/route.ts`)

- Integrated attachment linkage into the single invoice refresh endpoint
- Returns attachment linkage status in API response
- Properly handles cases where no attachment exists

### 3. New Manual Fix Endpoint (`apps/kpis/src/app/api/invoices/fix-attachments/route.ts`)

Created a new endpoint for retroactive fixes:

**POST** `/api/invoices/fix-attachments`
- Fix specific invoices by providing `invoiceIds` array
- Returns detailed results for each invoice

**GET** `/api/invoices/fix-attachments`
- Automatically finds and fixes all zero-value invoices (max 100)
- Useful for bulk remediation of existing issues

Response includes:
- Summary statistics (total, successful, failed, linked, etc.)
- Detailed results for each invoice
- Clear action indicators (linked, already_linked, no_attachment, error)

### 4. Diagnostic Endpoint (`apps/kpis/src/app/api/invoices/[id]/diagnose/route.ts`)

Created a diagnostic endpoint to help troubleshoot invoice issues:

**GET** `/api/invoices/{id}/diagnose`
- Returns detailed invoice status
- Shows attachment information
- Identifies specific issues (no attachment, not linked, OCR not run, etc.)
- Provides actionable recommendations
- Useful for debugging and support

### 5. Comprehensive Documentation (`apps/kpis/README-ODOO-DOCUMENT-NOT-FOUND-FIX.md`)

Created detailed documentation covering:
- Problem description and root cause
- Solution architecture
- Implementation details
- API usage examples
- Testing procedures
- Troubleshooting guide
- Future enhancement suggestions

## How It Works

### Automatic Flow (New Invoices)

```
1. System detects zero-value invoices during fetch
2. Background OCR refresh is triggered
3. For each invoice:
   a. Check message_main_attachment_id
   b. If missing, search for attachments
   c. Link first attachment to invoice
   d. Trigger OCR processing
4. Track and report results
```

### Manual Fix Flow (Existing Invoices)

```bash
# Fix all zero-value invoices
curl -X GET /api/invoices/fix-attachments

# Fix specific invoices
curl -X POST /api/invoices/fix-attachments \
  -H "Content-Type: application/json" \
  -d '{"invoiceIds": [123, 456, 789]}'
```

## API Response Example

```json
{
  "success": true,
  "summary": {
    "total": 50,
    "successful": 45,
    "failed": 5,
    "linked": 30,
    "alreadyLinked": 15,
    "noAttachment": 5
  },
  "results": [
    {
      "invoiceId": 123,
      "success": true,
      "action": "linked",
      "message": "Successfully linked attachment 456",
      "attachmentId": 456
    }
  ]
}
```

## Testing

Verified that:
- ✅ Build completes successfully with no errors
- ✅ No linter warnings introduced
- ✅ Attachment linkage function properly handles all edge cases
- ✅ OCR processing is skipped for invoices without attachments
- ✅ Detailed logging provides visibility into the process
- ✅ API endpoints return proper status codes and messages

## Impact

**Before:**
- Invoices with "document not found" required manual "Retry" clicks
- OCR wasn't triggered automatically
- Invoice approvals were blocked
- Manual intervention needed for every affected invoice

**After:**
- Attachment linking happens automatically
- OCR processes without manual intervention
- Invoice details are populated correctly
- Approvals can proceed normally
- Bulk fix available for existing problematic invoices

## Files Changed

```
Modified:
  apps/kpis/src/lib/odoo/services.ts
  apps/kpis/src/app/api/invoices/[id]/refresh-ocr/route.ts

Created:
  apps/kpis/src/app/api/invoices/fix-attachments/route.ts
  apps/kpis/src/app/api/invoices/[id]/diagnose/route.ts
  apps/kpis/README-ODOO-DOCUMENT-NOT-FOUND-FIX.md
  ODOO-FIX-PR-DESCRIPTION.md
```

## Deployment Notes

1. No database migrations required
2. No environment variable changes needed
3. Backward compatible with existing invoice processing
4. Can be deployed without downtime
5. Consider running the manual fix endpoint after deployment to remediate existing issues:
   ```bash
   curl -X GET https://your-domain.com/api/invoices/fix-attachments
   ```

## Future Enhancements

Potential improvements for future iterations:
- Smart attachment selection (prefer PDFs, latest file, etc.)
- Retry logic with exponential backoff
- Webhook integration for immediate attachment linking
- Monitoring dashboard for OCR processing status
- Integration with Odoo's Extract API for enhanced OCR

## Related Documentation

- [Odoo 18 Extract API](https://www.odoo.com/documentation/18.0/developer/reference/extract_api.html)
- [Odoo JSON-RPC API](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html)

## Issue Resolution

Resolves: Issue #43 (based on branch name `43-fix-odoo-the-document-could-not-be-found-issue`)

