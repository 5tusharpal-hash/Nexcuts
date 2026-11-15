import { ApiError } from '../../shared/errors/ApiError.js';
import { RefundRequest } from './pos_billing.refunds.types';

export class RefundService {
    async issueRefund(_request: RefundRequest): Promise<never> {
        throw new ApiError(
            410,
            'Legacy credit-note refunds are disabled; use the cash-only POS refund workflow'
        );
    }

    async applyCreditToBill(_userId: string, _salonId: string, _amount: number): Promise<never> {
        throw new ApiError(410, 'Salon credit balances are not supported; POS refunds are paid in cash');
    }
}
