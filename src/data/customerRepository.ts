import type { CustomerStatus } from '../schemas.js';

export interface Customer {
  readonly customerId: string;
  readonly name: string;
  readonly email: string;
  readonly status: CustomerStatus;
  readonly currency: string;
  readonly refundableBalanceCents: number;
  readonly createdAt: string;
}

export interface CustomerRepository {
  findById(customerId: string): Promise<Customer | undefined>;
  updateRefundableBalance(
    customerId: string,
    expectedBalanceCents: number,
    newBalanceCents: number,
  ): Promise<boolean>;
}

const SEED_CUSTOMERS: readonly Customer[] = [
  {
    customerId: 'CUST-00001',
    name: 'Alice Johnson',
    email: 'alice.johnson@example.com',
    status: 'active',
    currency: 'USD',
    refundableBalanceCents: 50_000,
    createdAt: '2024-01-15T09:30:00.000Z',
  },
  {
    customerId: 'CUST-00002',
    name: 'Bob Martinez',
    email: 'bob.martinez@example.com',
    status: 'suspended',
    currency: 'USD',
    refundableBalanceCents: 20_000,
    createdAt: '2024-03-02T14:05:00.000Z',
  },
  {
    customerId: 'CUST-00003',
    name: 'Carol Nguyen',
    email: 'carol.nguyen@example.com',
    status: 'active',
    currency: 'USD',
    refundableBalanceCents: 0,
    createdAt: '2024-06-20T17:45:00.000Z',
  },
];

class InMemoryCustomerRepository implements CustomerRepository {
  readonly #customers: Map<string, Customer>;

  constructor(customers: readonly Customer[]) {
    this.#customers = new Map(customers.map((customer) => [customer.customerId, customer]));
  }

  findById(customerId: string): Promise<Customer | undefined> {
    return Promise.resolve(this.#customers.get(customerId));
  }

  updateRefundableBalance(
    customerId: string,
    expectedBalanceCents: number,
    newBalanceCents: number,
  ): Promise<boolean> {
    const customer = this.#customers.get(customerId);
    if (customer?.refundableBalanceCents !== expectedBalanceCents) {
      return Promise.resolve(false);
    }
    this.#customers.set(customerId, { ...customer, refundableBalanceCents: newBalanceCents });
    return Promise.resolve(true);
  }
}

export function createInMemoryCustomerRepository(): CustomerRepository {
  return new InMemoryCustomerRepository(SEED_CUSTOMERS);
}
