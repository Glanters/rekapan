import { describe, expect, it } from 'vitest';

import { isIpAllowed } from './ip-match';

/** Builds a rule set from bare CIDR strings. */
function rules(...cidrs: string[]): { cidr: string }[] {
  return cidrs.map((cidr) => ({ cidr }));
}

describe('isIpAllowed', () => {
  it('lets everyone through while the list is empty (feature off)', () => {
    expect(isIpAllowed('203.0.113.5', [])).toBe(true);
    expect(isIpAllowed(undefined, [])).toBe(true);
    expect(isIpAllowed('unknown', [])).toBe(true);
  });

  it('matches a single IPv4 address exactly', () => {
    const list = rules('203.0.113.5');
    expect(isIpAllowed('203.0.113.5', list)).toBe(true);
    expect(isIpAllowed('203.0.113.6', list)).toBe(false);
  });

  it('matches an IPv4 CIDR range and rejects outside it', () => {
    const list = rules('203.0.113.0/24');
    expect(isIpAllowed('203.0.113.1', list)).toBe(true);
    expect(isIpAllowed('203.0.113.254', list)).toBe(true);
    expect(isIpAllowed('203.0.114.1', list)).toBe(false);
  });

  it('honours /32 and /0 prefixes', () => {
    expect(isIpAllowed('10.0.0.1', rules('10.0.0.1/32'))).toBe(true);
    expect(isIpAllowed('10.0.0.2', rules('10.0.0.1/32'))).toBe(false);
    expect(isIpAllowed('1.2.3.4', rules('0.0.0.0/0'))).toBe(true);
  });

  it('matches a v4-mapped IPv6 client against an IPv4 rule', () => {
    expect(isIpAllowed('::ffff:203.0.113.5', rules('203.0.113.0/24'))).toBe(true);
    expect(isIpAllowed('::ffff:203.0.114.5', rules('203.0.113.0/24'))).toBe(false);
  });

  it('matches IPv6 addresses and ranges', () => {
    expect(isIpAllowed('2001:db8::1', rules('2001:db8::1'))).toBe(true);
    expect(isIpAllowed('2001:db8::abcd', rules('2001:db8::/32'))).toBe(true);
    expect(isIpAllowed('2001:db9::1', rules('2001:db8::/32'))).toBe(false);
  });

  it('strips an IPv6 zone identifier before matching', () => {
    expect(isIpAllowed('fe80::1%eth0', rules('fe80::/64'))).toBe(true);
  });

  it('never matches across address families', () => {
    expect(isIpAllowed('203.0.113.5', rules('2001:db8::/32'))).toBe(false);
    expect(isIpAllowed('2001:db8::1', rules('203.0.113.0/24'))).toBe(false);
  });

  it('fails closed for a missing or unparseable address', () => {
    const list = rules('203.0.113.0/24');
    expect(isIpAllowed(undefined, list)).toBe(false);
    expect(isIpAllowed('unknown', list)).toBe(false);
    expect(isIpAllowed('not-an-ip', list)).toBe(false);
    expect(isIpAllowed('203.0.113.999', list)).toBe(false);
  });

  it('matches when any one of several rules covers the address', () => {
    const list = rules('10.0.0.0/8', '203.0.113.5', '2001:db8::/32');
    expect(isIpAllowed('10.9.9.9', list)).toBe(true);
    expect(isIpAllowed('203.0.113.5', list)).toBe(true);
    expect(isIpAllowed('2001:db8::99', list)).toBe(true);
    expect(isIpAllowed('192.168.1.1', list)).toBe(false);
  });
});
