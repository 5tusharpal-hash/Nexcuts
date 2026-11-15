export type InventoryProductType = 'RETAIL' | 'SALON_USE' | 'LEGACY_UNCLASSIFIED';
export type InventoryUnit = 'ML' | 'GRAM' | 'UNIT' | 'PACK';
export type InventoryContentUnit = 'ML' | 'GRAM' | 'UNIT';

export interface InventoryProduct {
    id: string;
    salonId: string;
    inventoryType: InventoryProductType;
    name: string;
    sku: string | null;
    description: string | null;
    category: string | null;
    baseUnit: InventoryUnit;
    contentQuantity: number | null;
    contentUnit: InventoryContentUnit | null;
    currentStock: number;
    reorderLevel: number;
    lowStockAlertEnabled: boolean;
    costPrice: number | null;
    retailPrice: number | null;
    isActive: boolean;
    barcodes: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateInventoryProductRequest {
    inventoryType: Exclude<InventoryProductType, 'LEGACY_UNCLASSIFIED'>;
    name: string;
    sku?: string;
    description?: string;
    category?: string;
    baseUnit: InventoryUnit;
    contentQuantity?: number;
    contentUnit?: InventoryContentUnit;
    reorderLevel: number;
    lowStockAlertEnabled: boolean;
    costPrice?: number;
    retailPrice?: number;
    barcodes: string[];
}

export interface UpdateInventoryProductRequest {
    name?: string;
    sku?: string | null;
    description?: string | null;
    category?: string | null;
    contentQuantity?: number | null;
    contentUnit?: InventoryContentUnit | null;
    reorderLevel?: number;
    lowStockAlertEnabled?: boolean;
    costPrice?: number | null;
    retailPrice?: number | null;
}

export interface ClassifyLegacyProductRequest {
    inventoryType: Exclude<InventoryProductType, 'LEGACY_UNCLASSIFIED'>;
}

export interface InventoryBatch {
    id: string;
    salonId: string;
    productId: string;
    batchNumber: string | null;
    expiryDate: string | null;
    initialQuantity: number;
    currentQuantity: number;
    costPerUnit: number | null;
    receivedAt: Date;
    expiryStatus: 'UNKNOWN' | 'EXPIRED' | 'NEAR_EXPIRY' | 'OK';
}

export interface ReceiveInventoryBatchRequest {
    batchNumber?: string;
    expiryDate?: string;
    quantity: number;
    costPerUnit?: number;
}

export interface InventoryAdjustmentRequest {
    batchId: string;
    quantityChange: number;
    reason: 'DAMAGE' | 'LOSS' | 'WASTE' | 'EXPIRY' | 'STOCK_COUNT' | 'FOUND' | 'RETURN';
    note: string;
}

export interface ConsumableMapping {
    serviceId: string;
    productId: string;
    productName: string;
    quantityRequired: number;
    quantityUnit: InventoryContentUnit;
}

export interface CreateConsumableMappingRequest {
    productId: string;
    quantityRequired: number;
}

export interface CreateInventoryIssueRequest {
    productId: string;
    targetType: 'STAFF' | 'FLOOR';
    targetMembershipId?: string;
    quantity: number;
    note?: string;
}

export interface ReviewInventoryIssueRequest {
    status: 'ISSUED' | 'REJECTED';
    batchId?: string;
    reason?: string;
    expiredOverrideReason?: string;
}

export interface CloseInventoryIssueRequest {
    status: 'EMPTY' | 'RETURNED' | 'DAMAGED' | 'LOST' | 'WASTED';
    note: string;
}

export interface InventoryPageQuery {
    limit: number;
    offset: number;
}

export interface InventoryLowStockAlert {
    productId: string;
    productName: string;
    inventoryType: InventoryProductType;
    currentStock: number;
    reorderLevel: number;
    unit: InventoryUnit;
}

export interface InventoryLedgerEntry {
    id: string;
    productId: string;
    batchId: string | null;
    quantityChange: number;
    reason: string;
    referenceId: string | null;
    createdByAccountId: string | null;
    note: string | null;
    createdAt: Date;
}

export interface ServiceConsumableUsageEntry {
    id: string;
    serviceId: string;
    productId: string;
    productName: string;
    billId: string;
    billItemId: string;
    estimatedQuantity: number;
    quantityUnit: InventoryContentUnit;
    recordedByAccountId: string;
    createdAt: Date;
}
