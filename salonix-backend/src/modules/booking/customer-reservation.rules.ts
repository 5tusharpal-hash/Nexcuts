export type ReservationInterval = {
    startsAt: Date;
    durationMinutes: number;
};

export function indiaDayKey(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

export function intervalsOverlap(first: ReservationInterval, second: ReservationInterval): boolean {
    const firstEnd = first.startsAt.getTime() + first.durationMinutes * 60_000;
    const secondEnd = second.startsAt.getTime() + second.durationMinutes * 60_000;
    return first.startsAt.getTime() < secondEnd && firstEnd > second.startsAt.getTime();
}

export function hasSameDayReservation(
    requestedStart: Date,
    reservations: ReservationInterval[],
    ignoredReservationIds: ReadonlySet<string> = new Set(),
    reservationId: (reservation: ReservationInterval) => string = () => '',
): boolean {
    const requestedDay = indiaDayKey(requestedStart);
    return reservations.some((reservation) =>
        !ignoredReservationIds.has(reservationId(reservation)) &&
        indiaDayKey(reservation.startsAt) === requestedDay
    );
}
