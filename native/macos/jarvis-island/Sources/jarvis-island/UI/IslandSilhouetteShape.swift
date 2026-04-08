import SwiftUI

struct IslandSilhouetteShape: Shape {
    private var crownRadius: CGFloat
    private var jawRadius: CGFloat

    init(topCornerRadius: CGFloat? = nil, bottomCornerRadius: CGFloat? = nil) {
        crownRadius = topCornerRadius ?? 6
        jawRadius = bottomCornerRadius ?? 14
    }

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { .init(crownRadius, jawRadius) }
        set {
            crownRadius = newValue.first
            jawRadius = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let upper = max(0, min(crownRadius, min(rect.width * 0.5, rect.height * 0.5)))
        let lower = max(0, min(jawRadius, min(rect.width * 0.45, rect.height * 0.7)))

        let leftTopX = rect.minX + upper
        let rightTopX = rect.maxX - upper
        let leftBottomX = rect.minX + upper + lower
        let rightBottomX = rect.maxX - upper - lower
        let topY = rect.minY
        let bottomY = rect.maxY
        let upperY = rect.minY + upper
        let lowerY = rect.maxY - lower

        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: topY))

        path.addQuadCurve(
            to: CGPoint(x: leftTopX, y: upperY),
            control: CGPoint(x: leftTopX, y: topY)
        )

        path.addLine(to: CGPoint(x: leftTopX, y: lowerY))

        path.addQuadCurve(
            to: CGPoint(x: leftBottomX, y: bottomY),
            control: CGPoint(x: leftTopX, y: bottomY)
        )

        path.addLine(to: CGPoint(x: rightBottomX, y: bottomY))

        path.addQuadCurve(
            to: CGPoint(x: rightTopX, y: lowerY),
            control: CGPoint(x: rightTopX, y: bottomY)
        )

        path.addLine(to: CGPoint(x: rightTopX, y: upperY))

        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: topY),
            control: CGPoint(x: rightTopX, y: topY)
        )

        path.addLine(to: CGPoint(x: rect.minX, y: topY))

        return path
    }
}
