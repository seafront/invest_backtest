import Foundation

/// 파이썬 random.Random (Mersenne Twister MT19937) 의 seed(int) · choice 만 옮겼다.
///
/// 최적화는 조합이 300개를 넘으면 random.Random(0) 으로 조합을 뽑는다. 같은 조합을 뽑아야
/// 웹과 같은 추천값이 나오므로 난수열까지 같아야 한다.
struct PythonRandom {
    private var mt = [UInt32](repeating: 0, count: 624)
    private var index = 624

    /// random.seed(n) (n ≥ 0 정수): n 을 32비트 단위로 쪼갠 배열로 init_by_array 한다
    init(seed: UInt64) {
        var key: [UInt32] = []
        var n = seed
        repeat {
            key.append(UInt32(truncatingIfNeeded: n))
            n >>= 32
        } while n > 0
        initByArray(key)
    }

    private mutating func initGenrand(_ s: UInt32) {
        mt[0] = s
        for i in 1..<624 {
            mt[i] = 1_812_433_253 &* (mt[i - 1] ^ (mt[i - 1] >> 30)) &+ UInt32(i)
        }
        index = 624
    }

    private mutating func initByArray(_ key: [UInt32]) {
        initGenrand(19_650_218)
        var i = 1, j = 0
        for _ in 0..<Swift.max(624, key.count) {
            mt[i] = (mt[i] ^ ((mt[i - 1] ^ (mt[i - 1] >> 30)) &* 1_664_525)) &+ key[j] &+ UInt32(j)
            i += 1; j += 1
            if i >= 624 { mt[0] = mt[623]; i = 1 }
            if j >= key.count { j = 0 }
        }
        for _ in 0..<623 {
            mt[i] = (mt[i] ^ ((mt[i - 1] ^ (mt[i - 1] >> 30)) &* 1_566_083_941)) &- UInt32(i)
            i += 1
            if i >= 624 { mt[0] = mt[623]; i = 1 }
        }
        mt[0] = 0x8000_0000
    }

    private mutating func next() -> UInt32 {
        if index >= 624 {
            for k in 0..<624 {
                let y = (mt[k] & 0x8000_0000) | (mt[(k + 1) % 624] & 0x7FFF_FFFF)
                mt[k] = mt[(k + 397) % 624] ^ (y >> 1) ^ ((y & 1) == 0 ? 0 : 0x9908_B0DF)
            }
            index = 0
        }
        var y = mt[index]
        index += 1
        y ^= y >> 11
        y ^= (y << 7) & 0x9D2C_5680
        y ^= (y << 15) & 0xEFC6_0000
        y ^= y >> 18
        return y
    }

    /// getrandbits(k), k ≤ 32
    private mutating func bits(_ k: Int) -> UInt32 { next() >> UInt32(32 - k) }

    /// _randbelow_with_getrandbits(n): n 의 비트 수만큼 뽑아 n 이상이면 다시 뽑는다
    mutating func below(_ n: Int) -> Int {
        let k = Int.bitWidth - n.leadingZeroBitCount
        var r = Int(bits(k))
        while r >= n { r = Int(bits(k)) }
        return r
    }

    mutating func choice<T>(_ xs: [T]) -> T { xs[below(xs.count)] }
}
