import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import {
  bigintTransformer,
  LedgerOwnerType,
  LedgerPurpose,
} from '../ledger.types';

/**
 * Một tài khoản trong sổ cái.
 *
 * Mỗi người dùng có nhiều tài khoản, mỗi cái giữ tiền ở một trạng thái:
 * (user 7, available), (user 7, escrow_hold)...
 *
 * `balance` là số dư đã tính sẵn cho nhanh. Nguồn sự thật vẫn là tổng của
 * ledger_entries — job đối soát mỗi giờ so hai con số này, lệch là báo.
 */
@Entity('ledger_accounts')
@Unique('uq_ledger_account', ['owner_type', 'owner_id', 'purpose'])
export class LedgerAccount {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'enum', enum: LedgerOwnerType })
  owner_type: LedgerOwnerType;

  /** Null với platform và external — chúng chỉ có một tài khoản mỗi purpose */
  @Column({ type: 'bigint', nullable: true })
  owner_id: string | null;

  @Column({ type: 'enum', enum: LedgerPurpose })
  purpose: LedgerPurpose;

  /** Đơn vị ĐỒNG */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  balance: bigint;

  /** TypeORM tự tăng mỗi lần save, dùng để phát hiện ghi đè chồng chéo */
  @VersionColumn()
  version: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
