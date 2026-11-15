import { prisma } from '../../bootstrap/db.connect';
import {
    StaffAccountData,
    StaffAvailability,
    StaffMember,
    StaffOnboardingData,
} from './staff.types';

export class StaffRepository {
    async createStaffWithUser(
        userData: StaffAccountData,
        staffData: StaffOnboardingData
    ): Promise<StaffMember> {
        return prisma.$transaction(async (tx) => {
            const salon = await tx.salon.findUnique({
                where: { id: staffData.salonId },
                select: { id: true, organizationId: true },
            });
            if (!salon) throw new Error('Salon branch not found');

            const user = await tx.account.upsert({
                where: {
                    accountType_email: {
                        accountType: 'SALON',
                        email: userData.email,
                    },
                },
                create: {
                    accountType: 'SALON',
                    email: userData.email,
                    passwordHash: userData.passwordHash,
                    phoneNumber: userData.phoneNumber,
                    fullName: userData.fullName,
                },
                update: {},
                select: { id: true },
            });

            const membership = await tx.salonMembership.upsert({
                where: {
                    organizationId_accountId: {
                        organizationId: salon.organizationId,
                        accountId: user.id,
                    },
                },
                create: {
                    organizationId: salon.organizationId,
                    accountId: user.id,
                    status: 'ACTIVE',
                    joinedAt: new Date(),
                },
                update: {},
                select: { id: true, status: true, joinedAt: true },
            });
            if (membership.status !== 'ACTIVE') {
                throw new Error('The existing salon membership is not active');
            }

            await tx.salonMembershipLocation.upsert({
                where: {
                    membershipId_salonId: {
                        membershipId: membership.id,
                        salonId: salon.id,
                    },
                },
                create: {
                    membershipId: membership.id,
                    organizationId: salon.organizationId,
                    salonId: salon.id,
                },
                update: {},
            });

            const roles = await tx.salonRole.findMany({
                where: {
                    organizationId: salon.organizationId,
                    key: { in: staffData.roles },
                },
                select: { id: true, key: true },
            });
            const missingRoles = staffData.roles.filter(
                (role) => !roles.some((existingRole) => existingRole.key === role)
            );
            if (missingRoles.length > 0) {
                throw new Error(`Salon roles not found: ${missingRoles.join(', ')}`);
            }

            await tx.salonMembershipRole.createMany({
                data: roles.map(({ id: roleId }) => ({
                    membershipId: membership.id,
                    organizationId: salon.organizationId,
                    salonId: salon.id,
                    roleId,
                })),
                skipDuplicates: true,
            });

            await tx.salonStaffProfile.upsert({
                where: { membershipId: membership.id },
                create: {
                    membershipId: membership.id,
                    organizationId: salon.organizationId,
                    accountId: user.id,
                    commissionRate: staffData.commissionRate,
                },
                update: { commissionRate: staffData.commissionRate },
            });

            if (staffData.expertise.length > 0) {
                await tx.salonStaffSkill.createMany({
                    data: staffData.expertise.map((serviceId) => ({
                        membershipId: membership.id,
                        salonId: salon.id,
                        serviceId,
                    })),
                    skipDuplicates: true,
                });
            }

            const rows = await tx.$queryRaw<StaffRow[]>`
                SELECT
                    membership.id,
                    membership.account_id AS "userId",
                    location.salon_id AS "salonId",
                    COALESCE(
                        ARRAY_AGG(DISTINCT role.key) FILTER (WHERE role.key IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS roles,
                    COALESCE(
                        ARRAY_AGG(DISTINCT skill.service_id::text) FILTER (WHERE skill.service_id IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS expertise,
                    membership.status,
                    profile.commission_rate AS "commissionRate",
                    COALESCE(membership.joined_at, membership.created_at) AS "joinedDate"
                FROM salon_memberships AS membership
                JOIN salon_membership_locations AS location
                  ON location.membership_id = membership.id
                JOIN salon_staff_profiles AS profile
                  ON profile.membership_id = membership.id
                LEFT JOIN salon_staff_skills AS skill
                  ON skill.membership_id = membership.id
                 AND skill.salon_id = location.salon_id
                LEFT JOIN salon_membership_roles AS membership_role
                  ON membership_role.membership_id = membership.id
                 AND membership_role.salon_id = location.salon_id
                LEFT JOIN salon_roles AS role ON role.id = membership_role.role_id
                WHERE membership.id = ${membership.id}
                  AND location.salon_id = ${salon.id}
                GROUP BY membership.id, location.salon_id, profile.commission_rate
            `;
            if (!rows[0]) throw new Error('Created staff membership could not be loaded');
            return this.toStaffMember(rows[0]);
        });
    }

    async findStaffByExpertise(salonId: string, serviceId: string): Promise<StaffMember[]> {
        const rows = await prisma.$queryRaw<StaffRow[]>`
            SELECT
                membership.id,
                membership.account_id AS "userId",
                location.salon_id AS "salonId",
                COALESCE(
                    ARRAY_AGG(DISTINCT role.key) FILTER (WHERE role.key IS NOT NULL),
                    ARRAY[]::text[]
                ) AS roles,
                COALESCE(
                    ARRAY_AGG(DISTINCT skill.service_id::text) FILTER (WHERE skill.service_id IS NOT NULL),
                    ARRAY[]::text[]
                ) AS expertise,
                membership.status,
                profile.commission_rate AS "commissionRate",
                COALESCE(membership.joined_at, membership.created_at) AS "joinedDate"
            FROM salon_memberships AS membership
            JOIN salon_membership_locations AS location
              ON location.membership_id = membership.id
            JOIN salon_staff_profiles AS profile
              ON profile.membership_id = membership.id
            JOIN salon_staff_skills AS matching_skill
              ON matching_skill.membership_id = membership.id
             AND matching_skill.salon_id = location.salon_id
            LEFT JOIN salon_staff_skills AS skill
              ON skill.membership_id = membership.id
             AND skill.salon_id = location.salon_id
            LEFT JOIN salon_membership_roles AS membership_role
              ON membership_role.membership_id = membership.id
             AND membership_role.salon_id = location.salon_id
            LEFT JOIN salon_roles AS role ON role.id = membership_role.role_id
            WHERE location.salon_id = ${salonId}
              AND matching_skill.service_id = ${serviceId}
              AND membership.status = 'ACTIVE'
            GROUP BY membership.id, location.salon_id, profile.commission_rate
            ORDER BY membership.id
        `;
        return rows.map((row) => this.toStaffMember(row));
    }

    async getAvailability(staffId: string): Promise<StaffAvailability[]> {
        const schedules = await prisma.salonStaffAvailability.findMany({
            where: { membershipId: staffId },
            orderBy: [{ salonId: 'asc' }, { dayOfWeek: 'asc' }, { startsAt: 'asc' }],
        });
        return schedules.map((schedule) => ({
            staffId: schedule.membershipId,
            dayOfWeek: schedule.dayOfWeek,
            startTime: this.formatTime(schedule.startsAt),
            endTime: this.formatTime(schedule.endsAt),
        }));
    }

    async updateCommission(staffId: string, rate: number): Promise<void> {
        await prisma.salonStaffProfile.update({
            where: { membershipId: staffId },
            data: { commissionRate: rate },
        });
    }

    async findStaffById(id: string): Promise<StaffMember | null> {
        const rows = await prisma.$queryRaw<StaffRow[]>`
            SELECT
                membership.id,
                membership.account_id AS "userId",
                location.salon_id AS "salonId",
                COALESCE(
                    ARRAY_AGG(DISTINCT role.key) FILTER (WHERE role.key IS NOT NULL),
                    ARRAY[]::text[]
                ) AS roles,
                COALESCE(
                    ARRAY_AGG(DISTINCT skill.service_id::text) FILTER (WHERE skill.service_id IS NOT NULL),
                    ARRAY[]::text[]
                ) AS expertise,
                membership.status,
                profile.commission_rate AS "commissionRate",
                COALESCE(membership.joined_at, membership.created_at) AS "joinedDate"
            FROM salon_memberships AS membership
            JOIN salon_membership_locations AS location
              ON location.membership_id = membership.id
            JOIN salon_staff_profiles AS profile
              ON profile.membership_id = membership.id
            LEFT JOIN salon_staff_skills AS skill
              ON skill.membership_id = membership.id
             AND skill.salon_id = location.salon_id
            LEFT JOIN salon_membership_roles AS membership_role
              ON membership_role.membership_id = membership.id
             AND membership_role.salon_id = location.salon_id
            LEFT JOIN salon_roles AS role ON role.id = membership_role.role_id
            WHERE membership.id = ${id}
            GROUP BY membership.id, location.salon_id, profile.commission_rate
            ORDER BY location.salon_id
            LIMIT 1
        `;
        return rows[0] ? this.toStaffMember(rows[0]) : null;
    }

    private toStaffMember(row: StaffRow): StaffMember {
        return {
            id: row.id,
            userId: row.userId,
            salonId: row.salonId,
            roles: row.roles,
            expertise: row.expertise,
            status: row.status as StaffMember['status'],
            commissionRate: Number(row.commissionRate),
            joinedDate: row.joinedDate,
        };
    }

    private formatTime(value: Date): string {
        return value.toISOString().slice(11, 16);
    }
}

interface StaffRow {
    id: string;
    userId: string;
    salonId: string;
    roles: string[];
    expertise: string[];
    status: string;
    commissionRate: number | string;
    joinedDate: Date;
}
