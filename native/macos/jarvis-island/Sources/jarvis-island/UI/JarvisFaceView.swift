import SwiftUI

struct JarvisFaceView: View {
    @State private var blinking = false

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                eye
                eye
            }
            VStack(spacing: 2) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(.white)
                    .frame(width: 3, height: 4)
                Path { path in
                    path.move(to: CGPoint(x: 0, y: 4))
                    path.addQuadCurve(to: CGPoint(x: 14, y: 4), control: CGPoint(x: 7, y: 9))
                }
                .stroke(.white, lineWidth: 2)
                .frame(width: 14, height: 10)
            }
        }
        .frame(width: 28, height: 24)
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
                withAnimation(.easeInOut(duration: 0.12)) {
                    blinking = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    withAnimation(.easeInOut(duration: 0.12)) {
                        blinking = false
                    }
                }
            }
        }
    }

    private var eye: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.white)
            .frame(width: 4, height: blinking ? 1 : 4)
    }
}
