#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Address, Env, Symbol};

#[contracterror]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
}

#[contract]
pub struct Contract;

// Storage layout: instance storage maps Address -> u32 value
const KEY_PREFIX: Symbol = symbol_short!("v");

#[contractimpl]
impl Contract {
    /// No-auth function.
    ///
    /// Purpose: basic call that requires no authorization. Useful for:
    /// - multi-op invalid XDR tests
    /// - smoke tests of simulation without any auth
    pub fn no_auth_bump(_env: Env, n: u32) -> u32 {
        n.saturating_add(1)
    }

    /// Address-auth function.
    ///
    /// Purpose: writes a value gated by the provided address. Valid payloads:
    /// - func+auth + sim=true
    /// - signed xdr + sim=false

    pub fn write_with_address_auth(env: Env, addr: Address, value: u32) {
        addr.require_auth();
        let k = (KEY_PREFIX, addr);
        env.storage().instance().set(&k, &value);
    }

    /// Source-account-auth (transaction source) function.
    ///
    /// Purpose: writes a value gated by the transaction invoker. Recommended payloads:
    /// - xdr + sim=true (plugin will auto-disable simulation due to source-account creds)
    /// - xdr + sim=false (pre-assembled and signed)
    pub fn write_with_source_auth(env: Env, addr: Address, value: u32) {
        addr.require_auth();
        let k = (KEY_PREFIX, addr);
        env.storage().instance().set(&k, &value);
    }

    /// Read the stored value for an address (default 0 if unset)
    pub fn read_value(env: Env, addr: Address) -> u32 {
        let k = (KEY_PREFIX, addr);
        env.storage().instance().get(&k).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env as _};

    #[test]
    fn round_trip() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, ());
        let client = ContractClient::new(&env, &id);

        let alice = Address::generate(&env);
        assert_eq!(client.no_auth_bump(&1), 2);
        client.write_with_address_auth(&alice, &7);
        assert_eq!(client.read_value(&alice), 7);

        // invoker path
        client.write_with_source_auth(&alice, &11);
        assert_eq!(client.read_value(&alice), 11);
    }
}
