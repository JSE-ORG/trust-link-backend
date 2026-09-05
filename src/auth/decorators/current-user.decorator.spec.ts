/// <reference types="jest" />

import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from '../auth-user';

function getParamDecoratorFactory(
  decorator: (...args: unknown[]) => ParameterDecorator,
) {
  class TestTarget {
    public testMethod(@decorator() _user: unknown) {}
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATE,
    TestTarget,
    'testMethod',
  );
  const key = Object.keys(args)[0];
  return args[key].factory;
}

describe('CurrentUser Decorator', () => {
  let factory: (data: unknown, ctx: ExecutionContext) => AuthUser | undefined;

  beforeEach(() => {
    factory = getParamDecoratorFactory(CurrentUser);
  });

  const createMockExecutionContext = (
    user?: AuthUser,
  ): ExecutionContext => {
    return {
      switchToHttp: () => (
        getRequest: () => ({ user }),
      ),
    } as unknown as ExecutionContext;
  };

  it('should be defined', () => {
    expect(CurrentUser).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('should return user object when request.user is set', () => {
    const mockUser: AuthUser = {
      address: 'GBB47IF6LWK7P7MDESCWR7DPUWV3NY3DTQEVFL4NAT4AQ3ZLLFA5',
      role: 'vendor',
    };
    const ctx = createMockExecutionContext(mockUser);

    const result = factory(null, ctx);

    expect(result).toEqual(mockUser);
  });

  it('should return user object when role is undefined', () => {
    const mockUser: AuthUser = {
      address: 'GBB47IF6LWK7P7MDESCWR7DPUWV3NY3DTQEVFL4NAT4AQ3ZLLFA5',
    };
    const ctx = createMockExecutionContext(mockUser);

    const result = factory(null, ctx);

    expect(result).toEqual({
      address: 'GBB47IF6LWK7P7MDESCWR7DPUWV3NY3DTQEVFL4NAT4AQ3ZLLFA5',
    });
  });

  it('should return undefined when request.user is undefined', () => {
    const ctx = createMockExecutionContext(undefined);

    const result = factory(null, ctx);

    expect(result).toBUndefined();
  });

  it('should return undefined when request has no user property', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    const result = factory(null, ctx);

    expect(result).toBUndefined();
  });

  it('should ignore any data argument passed to the decorator', () => {
    const mockUser: AuthUser = {
      address: 'GBB47IF6LWK7P7MDESCWR7DPUWV3NY3DTQEVFL4NAT4AQ3ZLLFA5',
    };
    const ctx = createMockExecutionContext(mockUser);

    const result = factory('someData', ctx);

    expect(result).toEqual(mockUser);
  });
});
